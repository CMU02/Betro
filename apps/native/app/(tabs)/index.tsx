import {
	NaverMapView,
	type NaverMapViewRef,
} from "@mj-studio/react-native-naver-map";
import { useRouter } from "expo-router";
import { BottomTabBarHeightContext } from "expo-router/js-tabs";
import {
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyCard } from "@/components/map/empty-card";
import { MapPill } from "@/components/map/map-pill";
import { PlaceChips } from "@/components/map/place-chips";
import {
	NearbyLines,
	type RouteLineLeg,
	RouteLines,
} from "@/components/map/route-lines";
import { RouteMenu } from "@/components/map/route-menu";
import {
	type MarkerVehicle,
	VehicleMarkers,
} from "@/components/map/vehicle-markers";
import { VehicleSheet } from "@/components/map/vehicle-sheet";
import { useAppTheme } from "@/contexts/app-theme-context";
import type { ActiveSessionView } from "@/lib/commute/session-client";
import { useActiveSession } from "@/lib/commute/use-active-session";
import { t } from "@/lib/i18n/t";
import { nearestApproachingPoint } from "@/lib/map/camera-region";
import { lineColor } from "@/lib/map/line-color";
import { estimatedBoardNotice, routeOptionLabel } from "@/lib/map/map-labels";
import { type MapRegion, regionOf, spanSegments } from "@/lib/map/route-shape";
import {
	getUserSelection,
	initialSelection,
	type MapSelection,
	placeChips,
	routeOptions,
	setUserSelection,
	validSelection,
} from "@/lib/map/selection";
import { useHere } from "@/lib/map/use-here";
import {
	type MapData,
	type MapLeg,
	type RenderVehicle,
	useMapData,
} from "@/lib/map/use-map-data";
import { useMapVisible } from "@/lib/map/use-map-visible";
import {
	type NearbyPath,
	type NearbyTrain,
	useNearbyTrains,
} from "@/lib/map/use-nearby-trains";
import { appPlaces } from "@/lib/places/app-places";
import { badgeOf } from "@/lib/places/place-card-model";
import type { BusMetaMap, Place } from "@/lib/places/places";
import { usePlaces } from "@/lib/places/use-places";
import { usePreferences } from "@/lib/preferences/use-preferences";
import type { ThemeMode } from "@/theme/tokens";

/** 처음 보여줄 곳: 서울시청 부근. 위치 권한이 없거나 경로를 아직 못 그렸을 때의 기본 카메라다. */
const INITIAL_CAMERA = {
	latitude: 37.5666,
	longitude: 126.9784,
	zoom: 14,
} as const;

const MAP_STYLE = { flex: 1 } as const;
/** 차량을 눌렀을 때 확대 수준(지도 설계 2.4). */
const VEHICLE_ZOOM = 16;
/** 장소가 없을 때 내 위치로 옮기는 확대 수준. */
const NEARBY_ZOOM = 14;
/** 시트가 열린 동안 차량을 따라 카메라를 옮기는 간격. */
const FOLLOW_INTERVAL_MS = 2000;
/** 경로 전체에 맞출 때 가로·세로 양쪽에 두는 여백 비율. */
const ROUTE_PADDING_RATIO = 0.15;
/** 노선 전체(승차~하차 밖)를 그리는 옅은 선의 불투명도. */
const FAINT_LINE_OPACITY = 0.35;
/** 지도 위 카드·칩과 화면 가장자리(탭바) 사이 간격. */
const OVERLAY_GAP = 12;
/** 칩과 그 아래 알약이 차지하는 높이. 경로를 맞출 때 이만큼 위를 비운다. */
const TOP_OVERLAY_HEIGHT = 88;

type Shape = readonly [number, number][];

/** 지도에서 볼 장소와 경로. 사용자가 고른 선택이 우선이고, 없거나 사라졌으면 처음 선택 규칙을 따른다(지도 설계 3장). */
function useRouteSelection(
	places: readonly Place[],
	session: ActiveSessionView | null
): { choose: (next: MapSelection) => void; selection: MapSelection | null } {
	const [openedAt] = useState(Date.now);
	const [userChoice, setUserChoice] = useState(getUserSelection);
	const selection =
		validSelection(places, userChoice) ??
		initialSelection(places, session, openedAt);
	const choose = useCallback((next: MapSelection) => {
		setUserSelection(next);
		setUserChoice(next);
	}, []);
	return { choose, selection };
}

function vehicleKey(vehicle: RenderVehicle): string {
	return `${vehicle.legIndex}:${vehicle.id}`;
}

function findVehicle(
	legs: readonly MapLeg[],
	key: string | null
): { mapLeg: MapLeg; vehicle: RenderVehicle } | null {
	if (key === null) {
		return null;
	}
	for (const mapLeg of legs) {
		const vehicle = mapLeg.vehicles.find((item) => vehicleKey(item) === key);
		if (vehicle) {
			return { mapLeg, vehicle };
		}
	}
	return null;
}

/** 카메라가 향할 차량 자리. 부드러운 움직임을 끄면 마커가 관측 위치에 있으므로 거기로 간다. */
function cameraTargetOf(
	vehicle: RenderVehicle,
	smooth: boolean
): { latitude: number; longitude: number } {
	const { latitude, longitude } = smooth ? vehicle : vehicle.observedPosition;
	return { latitude, longitude };
}

function legColor(
	mapLeg: MapLeg,
	busMeta: BusMetaMap,
	mode: ThemeMode,
	opacity?: number
): string {
	return lineColor(badgeOf(mapLeg.leg, busMeta), mode, opacity);
}

function routeLineLegs(
	legs: readonly MapLeg[],
	busMeta: BusMetaMap,
	mode: ThemeMode
): RouteLineLeg[] {
	return legs.flatMap((mapLeg, index) =>
		mapLeg.track === null
			? []
			: [
					{
						alightM: mapLeg.alightM,
						boardM: mapLeg.boardM,
						color: legColor(mapLeg, busMeta, mode),
						faintColor: legColor(mapLeg, busMeta, mode, FAINT_LINE_OPACITY),
						key: `${index}:${mapLeg.leg.line}`,
						shape: mapLeg.track.shape,
					},
				]
	);
}

function routeMarkers(
	legs: readonly MapLeg[],
	busMeta: BusMetaMap,
	mode: ThemeMode
): MarkerVehicle[] {
	return legs.flatMap((mapLeg) => {
		const { track } = mapLeg;
		if (track === null) {
			return [];
		}
		const color = legColor(mapLeg, busMeta, mode);
		return mapLeg.vehicles.map((vehicle) => ({
			color,
			key: vehicleKey(vehicle),
			kind: vehicle.kind,
			motion: vehicle.motion,
			observedPosition: vehicle.observedPosition,
			shape: track.shape,
		}));
	});
}

function nearbyMarkers(
	trains: readonly NearbyTrain[],
	mode: ThemeMode
): MarkerVehicle[] {
	return trains.map((train) => ({
		color: lineColor({ line: train.line, mode: "subway", name: "" }, mode),
		key: train.id,
		kind: "subway",
		motion: train.motion,
		observedPosition: train.observedPosition,
		shape: train.shape,
	}));
}

function nearbyPathsOf(
	paths: readonly NearbyPath[],
	mode: ThemeMode
): { color: string; key: string; shape: Shape }[] {
	return paths.map((path) => ({
		color: lineColor(
			{ line: path.line, mode: "subway", name: "" },
			mode,
			FAINT_LINE_OPACITY
		),
		key: path.key,
		shape: path.shape,
	}));
}

/**
 * 경로 전체가 들어오는 영역. 승차~하차 구간에 맞추고, 아직 못 자르면 노선 전체에 맞춘다.
 * 첫 구간에서 승차 정류장에 가장 가까이 다가오는 차량도 담는다(지도 설계 3장).
 */
function routeRegionOf(legs: readonly MapLeg[]): MapRegion | null {
	const spans = legs.flatMap((mapLeg) =>
		mapLeg.track === null
			? []
			: spanSegments(mapLeg.track.shape, mapLeg.boardM, mapLeg.alightM).flat()
	);
	if (spans.length > 0) {
		const approaching = nearestApproachingPoint(legs);
		return regionOf(
			approaching === null ? spans : [...spans, approaching],
			ROUTE_PADDING_RATIO
		);
	}
	const whole: Shape[number][] = legs.flatMap((mapLeg) =>
		mapLeg.track === null ? [] : [...mapLeg.track.shape]
	);
	return regionOf(whole, ROUTE_PADDING_RATIO);
}

/**
 * 선이 바뀔 때와 다가오는 차량이 처음 나타날 때만 카메라 영역을 다시 잰다.
 * 차량이 움직일 때마다 바뀌지 않는 값이다.
 */
function fitKeyOf(legs: readonly MapLeg[]): string {
	const lines = legs
		.map(
			(mapLeg) =>
				`${mapLeg.leg.line}:${mapLeg.track?.shape.length ?? 0}:${mapLeg.boardM}:${mapLeg.alightM}`
		)
		.join("|");
	return `${lines}|approach:${nearestApproachingPoint(legs) !== null}`;
}

/**
 * 카메라 맞춤. 경로가 바뀌거나 선을 처음 받으면 경로 전체로 맞추고, 사용자가 지도를 직접 움직였거나
 * 시트가 열려 있으면 맞추지 않는다(지도 설계 3장).
 */
function useFitRoute(args: {
	fitKey: string;
	mapRef: RefObject<NaverMapViewRef | null>;
	ready: boolean;
	region: MapRegion | null;
	sheetOpen: boolean;
	userMoved: RefObject<boolean>;
}): void {
	const { fitKey, mapRef, ready, region, sheetOpen, userMoved } = args;
	const fittedFor = useRef<string | null>(null);
	useEffect(() => {
		if (!ready || region === null || sheetOpen || userMoved.current) {
			return;
		}
		if (fittedFor.current === fitKey) {
			return;
		}
		fittedFor.current = fitKey;
		mapRef.current?.animateRegionTo(region);
	}, [fitKey, mapRef, ready, region, sheetOpen, userMoved]);
}

/** 시트가 열린 동안 2초마다 그 차량으로 카메라를 옮긴다. 지도가 안 보이거나 사용자가 움직였으면 쉰다. */
function useFollowVehicle(args: {
	mapRef: RefObject<NaverMapViewRef | null>;
	position: { latitude: number; longitude: number } | null;
	selectedKey: string | null;
	userMoved: RefObject<boolean>;
}): void {
	const { mapRef, position, selectedKey, userMoved } = args;
	const visible = useMapVisible();
	const latest = useRef(position);
	latest.current = position;
	useEffect(() => {
		if (selectedKey === null || !visible) {
			return;
		}
		const timer = setInterval(() => {
			const at = latest.current;
			if (at !== null && !userMoved.current) {
				mapRef.current?.animateCameraTo({ ...at, zoom: VEHICLE_ZOOM });
			}
		}, FOLLOW_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [mapRef, selectedKey, userMoved, visible]);
}

interface MapRefs {
	mapRef: RefObject<NaverMapViewRef | null>;
	userMoved: RefObject<boolean>;
}

/**
 * 차량 시트. 차량을 누르면 확대하고 열고, 닫으면 경로 전체로 돌아간다(지도 설계 2.4).
 * 고른 차량이 승차 정류장을 지나 목록에서 빠지면 닫는다.
 */
function useVehicleSheet(
	{ mapRef, userMoved }: MapRefs,
	legs: readonly MapLeg[],
	routeRegion: MapRegion | null,
	smooth: boolean
) {
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const found = findVehicle(legs, selectedKey);
	const sheetVehicle =
		found !== null &&
		found.mapLeg.map !== null &&
		found.vehicle.positionSeq !== null
			? found
			: null;

	useFollowVehicle({
		mapRef,
		position:
			sheetVehicle === null
				? null
				: cameraTargetOf(sheetVehicle.vehicle, smooth),
		selectedKey,
		userMoved,
	});

	const closeSheet = useCallback(() => {
		setSelectedKey(null);
		userMoved.current = false;
		if (routeRegion !== null) {
			mapRef.current?.animateRegionTo(routeRegion);
		}
	}, [mapRef, routeRegion, userMoved]);

	const selectionLost = selectedKey !== null && sheetVehicle === null;
	useEffect(() => {
		if (selectionLost) {
			closeSheet();
		}
	}, [selectionLost, closeSheet]);

	const openVehicle = useCallback(
		(key: string) => {
			const target = findVehicle(legs, key);
			if (target === null) {
				return;
			}
			setSelectedKey(key);
			userMoved.current = false;
			mapRef.current?.animateCameraTo({
				...cameraTargetOf(target.vehicle, smooth),
				zoom: VEHICLE_ZOOM,
			});
		},
		[legs, mapRef, smooth, userMoved]
	);

	return {
		clearSheet: useCallback(() => setSelectedKey(null), []),
		closeSheet,
		openVehicle,
		selectedKey,
		sheetVehicle,
	};
}

/** 장소가 없으면 내 위치를 한 번 가운데 둔다. 권한이 없으면 서울시청 그대로다. */
function useCenterOnHere(
	{ mapRef, userMoved }: MapRefs,
	ready: boolean,
	here: { latitude: number; longitude: number } | null
): void {
	const centered = useRef(false);
	useEffect(() => {
		if (!ready || here === null || centered.current) {
			return;
		}
		centered.current = true;
		if (!userMoved.current) {
			mapRef.current?.animateCameraTo({ ...here, zoom: NEARBY_ZOOM });
		}
	}, [here, mapRef, ready, userMoved]);
}

/** 칩 위·경로 목록 아래의 알약들. 지금 경로, 노선이 모두 꺼졌다는 안내, 실시간이 없는 구간 안내, 시간표 추정 도착 예상이다. */
function RouteStatus({
	allHidden,
	estimated,
	noRealtime,
	routeLabel,
}: {
	allHidden: boolean;
	estimated: string | null;
	noRealtime: boolean;
	routeLabel: string | null;
}) {
	return (
		<View className="gap-2 px-4" pointerEvents="box-none">
			{routeLabel === null ? null : <MapPill label={routeLabel} />}
			{allHidden ? <MapPill label={t("map.allHidden")} /> : null}
			{noRealtime ? <MapPill label={t("map.noRealtime")} /> : null}
			{estimated === null ? null : (
				<MapPill label={estimated} tone="estimated" />
			)}
		</View>
	);
}

function estimatedOf(data: MapData): string | null {
	return estimatedBoardNotice(
		data.legs.map((mapLeg) => ({
			leg: mapLeg.leg,
			showVehicles: mapLeg.showVehicles,
			vehicleCount: mapLeg.vehicles.length,
		})),
		data.view,
		Date.now()
	);
}

/** 장소가 있을 때 지도 위쪽. 장소 칩과, 펼쳤으면 경로 목록, 아니면 지금 경로와 안내다. */
function PlacesOverlay({
	data,
	menuOpen,
	onPressChip,
	onPressRoute,
	places,
	selection,
}: {
	data: MapData;
	menuOpen: boolean;
	onPressChip: (placeId: string) => void;
	onPressRoute: (rank: number) => void;
	places: readonly Place[];
	selection: MapSelection | null;
}) {
	const place =
		places.find((candidate) => candidate.id === selection?.placeId) ?? null;
	const options =
		place === null || selection === null ? [] : routeOptions(place, selection);
	const current = options.find((option) => option.selected) ?? null;
	return (
		<>
			<PlaceChips
				chips={placeChips(places, selection)}
				menuOpen={menuOpen}
				onPress={onPressChip}
			/>
			{menuOpen ? (
				<RouteMenu onSelect={onPressRoute} options={options} />
			) : (
				<RouteStatus
					allHidden={data.allHidden}
					estimated={estimatedOf(data)}
					noRealtime={data.legs.some((mapLeg) => !mapLeg.realtime)}
					routeLabel={current === null ? null : routeOptionLabel(current)}
				/>
			)}
		</>
	);
}

/** 세션이 따르는 기본 경로를 지금 타고 있는가. 그 구간 차량은 탄 차량 하나뿐이다(지도 설계 2.8). */
function isRiding(
	data: MapData,
	session: ActiveSessionView | null,
	selection: MapSelection | null
): boolean {
	return (
		data.source === "session" &&
		selection?.rank === 0 &&
		session?.content.stage === "ride"
	);
}

function SelectedSheet({
	bottomOffset,
	busMeta,
	mode,
	onClose,
	onHeight,
	selected,
	toAlight,
	view,
}: {
	bottomOffset: number;
	busMeta: BusMetaMap;
	mode: ThemeMode;
	onClose: () => void;
	onHeight: (height: number) => void;
	selected: { mapLeg: MapLeg; vehicle: RenderVehicle };
	toAlight: boolean;
	view: MapData["view"];
}) {
	const { mapLeg, vehicle } = selected;
	if (mapLeg.map === null || vehicle.positionSeq === null) {
		return null;
	}
	return (
		<VehicleSheet
			badge={badgeOf(mapLeg.leg, busMeta)}
			bottomOffset={bottomOffset}
			color={legColor(mapLeg, busMeta, mode)}
			leg={mapLeg.leg}
			map={mapLeg.map}
			onClose={onClose}
			onHeight={onHeight}
			toAlight={toAlight}
			vehicle={{
				id: vehicle.id,
				observedAt: vehicle.observedAt,
				positionSeq: vehicle.positionSeq,
			}}
			view={view?.legs[vehicle.legIndex] ?? null}
		/>
	);
}

function useBottomOverlay(): number {
	const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
	return Platform.OS === "ios" ? tabBarHeight : 0;
}

/**
 * 지도 탭(04). 고른 장소로 가는 경로 하나의 노선 선과 차량을 그린다(지도 설계 2.1).
 * - 위쪽 장소 칩으로 장소를 바꾸고, 고른 칩을 다시 누르면 경로 목록이 펼쳐진다(2.2).
 * - 차량을 누르면 확대하고 시트를 연다. 시트를 닫으면 경로 전체로 돌아간다(2.4).
 * - 장소가 없으면 카드와 내 위치 근처 지하철 열차를 보인다. 한 경로 원칙의 유일한 예외다(2.5).
 * 네이버 지도의 야간 모드는 `Navi` 유형에서만 동작하므로 다크 테마는 `Navi` + 야간 모드, 라이트는 `Basic`을 쓴다.
 * 지도는 화면 전체에 깔고, 상태 표시줄과 iOS의 떠 있는 탭바만큼 `mapPadding`을 줘서 네이버 로고가 가려지지 않게 한다.
 */
export default function MapTab() {
	const { isDark } = useAppTheme();
	const themeMode: ThemeMode = isDark ? "dark" : "light";
	const [preferences] = usePreferences();
	const insets = useSafeAreaInsets();
	const bottomOverlay = useBottomOverlay();
	const router = useRouter();

	const { places } = usePlaces(appPlaces);
	const hasPlaces = places.length > 0;
	const { state: sessionState } = useActiveSession({ enabled: hasPlaces });
	const { choose, selection } = useRouteSelection(
		places,
		sessionState?.session ?? null
	);
	const busMeta =
		places.find((candidate) => candidate.id === selection?.placeId)?.busMeta ??
		{};
	const data = useMapData(selection, places);

	// 장소가 없을 때만 위치를 읽는다. 위치는 이 화면 안에서만 쓰고 서버로 보내지 않는다.
	const here = useHere(!hasPlaces);
	const nearby = useNearbyTrains(hasPlaces ? null : here);

	const mapRef = useRef<NaverMapViewRef>(null);
	const userMoved = useRef(false);
	const refs = useMemo(() => ({ mapRef, userMoved }), []);
	const [mapReady, setMapReady] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);

	const fitKey = `${selection?.placeId}:${selection?.rank}|${fitKeyOf(data.legs)}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: data.legs는 1초마다 새 배열이라 선이 바뀔 때(fitKey)만 다시 잰다.
	const routeRegion = useMemo(() => routeRegionOf(data.legs), [fitKey]);
	const sheet = useVehicleSheet(
		refs,
		data.legs,
		routeRegion,
		data.smoothVehicleMotion
	);
	const [sheetHeight, setSheetHeight] = useState(0);
	useFitRoute({
		fitKey,
		mapRef,
		ready: mapReady,
		region: routeRegion,
		sheetOpen: sheet.selectedKey !== null,
		userMoved,
	});
	useCenterOnHere(refs, mapReady && !hasPlaces, here);

	const { clearSheet, closeSheet, openVehicle, selectedKey } = sheet;
	const chooseAndReset = useCallback(
		(next: MapSelection) => {
			choose(next);
			setMenuOpen(false);
			clearSheet();
			userMoved.current = false;
		},
		[choose, clearSheet]
	);
	const pressChip = useCallback(
		(placeId: string) => {
			if (placeId === selection?.placeId) {
				setMenuOpen((open) => !open);
				return;
			}
			chooseAndReset({ placeId, rank: 0 });
		},
		[chooseAndReset, selection?.placeId]
	);
	const pressRoute = useCallback(
		(rank: number) => {
			if (selection !== null) {
				chooseAndReset({ placeId: selection.placeId, rank });
			}
		},
		[chooseAndReset, selection]
	);
	const pressVehicle = useCallback(
		(key: string) => {
			setMenuOpen(false);
			openVehicle(key);
		},
		[openVehicle]
	);
	const tapMap = useCallback(() => {
		if (menuOpen) {
			setMenuOpen(false);
			return;
		}
		if (selectedKey !== null) {
			closeSheet();
		}
	}, [closeSheet, menuOpen, selectedKey]);
	const cameraChanged = useCallback(({ reason }: { reason: string }) => {
		if (reason === "Gesture") {
			userMoved.current = true;
		}
	}, []);
	const ready = useCallback(() => setMapReady(true), []);
	const register = useCallback(() => router.navigate("/commute"), [router]);

	const markers = hasPlaces
		? routeMarkers(data.legs, busMeta, themeMode)
		: nearbyMarkers(nearby.trains, themeMode);
	const bottomOffset = bottomOverlay + OVERLAY_GAP;
	// 시트가 열려 있으면 그 높이만큼 아래를 비워, 확대하고 따라가는 차량이 시트 위에 보이게 한다.
	const sheetInset =
		sheet.sheetVehicle === null ? 0 : sheetHeight + OVERLAY_GAP;
	const mapPadding = useMemo(
		() => ({
			bottom: bottomOverlay + sheetInset,
			top: insets.top + (hasPlaces ? TOP_OVERLAY_HEIGHT : 0),
		}),
		[bottomOverlay, hasPlaces, insets.top, sheetInset]
	);
	const topStyle = useMemo(
		() => ({ top: insets.top + OVERLAY_GAP }),
		[insets.top]
	);

	return (
		<View className="flex-1 bg-bg-canvas">
			<NaverMapView
				buildingHeight={preferences.show3dBuildings ? 1 : 0}
				initialCamera={INITIAL_CAMERA}
				isExtentBoundedInKorea
				isNightModeEnabled={isDark}
				isShowLocationButton={false}
				isShowZoomControls={false}
				locale="ko"
				mapPadding={mapPadding}
				mapType={isDark ? "Navi" : "Basic"}
				onCameraChanged={cameraChanged}
				onInitialized={ready}
				onTapMap={tapMap}
				ref={mapRef}
				style={MAP_STYLE}
			>
				{hasPlaces ? (
					<RouteLines legs={routeLineLegs(data.legs, busMeta, themeMode)} />
				) : (
					<NearbyLines paths={nearbyPathsOf(nearby.paths, themeMode)} />
				)}
				<VehicleMarkers
					onPress={hasPlaces ? pressVehicle : undefined}
					selectedKey={selectedKey}
					smooth={data.smoothVehicleMotion}
					vehicles={markers}
				/>
			</NaverMapView>
			<View
				className="absolute inset-x-0 gap-2"
				pointerEvents="box-none"
				style={topStyle}
			>
				{hasPlaces ? (
					<PlacesOverlay
						data={data}
						menuOpen={menuOpen}
						onPressChip={pressChip}
						onPressRoute={pressRoute}
						places={places}
						selection={selection}
					/>
				) : (
					<View className="px-4" pointerEvents="box-none">
						{nearby.paths.length > 0 ? (
							<MapPill label={t("map.nearby")} tone="live" />
						) : null}
					</View>
				)}
			</View>
			{hasPlaces ? null : (
				<EmptyCard bottomOffset={bottomOffset} onRegister={register} />
			)}
			{sheet.sheetVehicle === null ? null : (
				<SelectedSheet
					bottomOffset={bottomOffset}
					busMeta={busMeta}
					mode={themeMode}
					onClose={closeSheet}
					onHeight={setSheetHeight}
					selected={sheet.sheetVehicle}
					toAlight={
						isRiding(data, sessionState?.session ?? null, selection) &&
						sheet.sheetVehicle.vehicle.legIndex ===
							sessionState?.session?.content.legIndex
					}
					view={data.view}
				/>
			)}
		</View>
	);
}

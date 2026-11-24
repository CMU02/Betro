import { NaverMapView } from "@mj-studio/react-native-naver-map";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BusFrontIcon, StarIcon } from "lucide-react-native";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable, withUniwind } from "uniwind";
import { RouteLines } from "@/components/map/route-lines";
import {
	type MarkerVehicle,
	VehicleMarkers,
} from "@/components/map/vehicle-markers";
import { LineBadge } from "@/components/transit/line-badge";
import { TimelineStop } from "@/components/transit/timeline-stop";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { OfflineNotice } from "@/components/ui/offline-notice";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { StatusTag } from "@/components/ui/status-tag";
import { TopBar } from "@/components/ui/top-bar";
import { useAppTheme } from "@/contexts/app-theme-context";
import {
	type BusRouteModel,
	type BusTimelineStop,
	busRouteModel,
} from "@/lib/detail/bus-route-model";
import {
	type BusRouteViewResponse,
	fetchBusRouteView,
} from "@/lib/detail/detail-client";
import { useScreenVisible } from "@/lib/detail/use-screen-visible";
import { appFavorites } from "@/lib/favorites/app-favorites";
import { favoriteId } from "@/lib/favorites/favorites";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import { appWatchRegistry } from "@/lib/map/app-watch-registry";
import { lineColor } from "@/lib/map/line-color";
import {
	type BusMap,
	type BusSnapshot,
	type BusSnapshotVehicle,
	fetchSnapshot,
} from "@/lib/map/map-client";
import {
	busTrackPoint,
	createBusTrack,
	cumulativeM,
	type MotionState,
	observe,
} from "@/lib/map/motion";
import { loadRefMap, MAP_REF_STALE_MS } from "@/lib/map/use-map-data";
import { serverClient } from "@/lib/server/app-server";
import type { EtaStatus } from "@/lib/transit/eta-status";
import { hexWithAlpha, type ThemeMode } from "@/theme/tokens";

const Star = withUniwind(StarIcon);
const BusIcon = withUniwind(BusFrontIcon);

const WATCH_OWNER = "bus-detail";
const STAR_SIZE = 22;
const MAP_HEIGHT = 220;
const BUS_ICON_SIZE = 16;
const BOTTOM_PADDING = 16;
const FAINT_LINE_OPACITY = 0.35;
/** 스냅샷은 10초, 노선 보기는 30초마다 다시 받는다. 서버는 60초 캐시라 상류 호출은 늘지 않는다. */
const SNAPSHOT_POLL_MS = 10_000;
const VIEW_POLL_MS = 30_000;
const MAP_STYLE = { height: MAP_HEIGHT } as const;
const NO_VEHICLES: BusSnapshotVehicle[] = [];
const NO_MARKERS: MarkerVehicle[] = [];
const NO_DIRECTIONS: string[] = [];

const TAG_KEY: Record<EtaStatus["kind"], MessageKey> = {
	ended: "eta.ended",
	estimated: "commute.lock.tag.estimated",
	live: "commute.lock.tag.live",
};

function numberParam(value: string | undefined): number | null {
	if (value === undefined) {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/** 보이는 동안만 이 노선을 관측하도록 알린다. 지도 경로의 관측은 registry가 합쳐 지우지 않는다. */
function useWatchLine(line: string, visible: boolean) {
	useEffect(() => {
		if (visible) {
			appWatchRegistry.claim(WATCH_OWNER, [line]);
		} else {
			appWatchRegistry.release(WATCH_OWNER);
		}
	}, [line, visible]);
	useEffect(() => () => appWatchRegistry.release(WATCH_OWNER), []);
}

/** 버스 스냅샷. 304이면 앞서 받은 값을 그대로 둔다. */
function useBusSnapshot(visible: boolean): BusSnapshot | null {
	const etag = useRef<string | null>(null);
	const last = useRef<BusSnapshot | null>(null);
	const query = useQuery({
		queryFn: async () => {
			const result = await fetchSnapshot(serverClient, "bus", etag.current);
			if (result.ok && result.value !== "not-modified") {
				etag.current = result.value.etag;
				last.current = result.value.snapshot as BusSnapshot;
			}
			return last.current;
		},
		queryKey: ["bus-detail", "snapshot"],
		refetchInterval: visible ? SNAPSHOT_POLL_MS : false,
		staleTime: 0,
	});
	return query.data ?? null;
}

/** 서버가 모르는 노선(경기·인천 포함)이면 ok가 false다. 폴링 실패는 마지막 값을 둔다. */
function useRouteView(line: string, visible: boolean) {
	return useQuery({
		queryFn: () => fetchBusRouteView(serverClient, line),
		queryKey: ["bus-detail", "view", line],
		refetchInterval: visible ? VIEW_POLL_MS : false,
		staleTime: 0,
	});
}

/** 관측이 들어올 때마다 차량별 움직임을 이어 간다. */
function useMarkers(
	map: BusMap | null,
	vehicles: BusSnapshotVehicle[],
	color: string
): MarkerVehicle[] {
	const motion = useRef(new Map<string, MotionState>());
	const track = useMemo(
		() => (map === null ? null : createBusTrack(map)),
		[map]
	);
	return useMemo(() => {
		if (track === null) {
			return NO_MARKERS;
		}
		const seen = new Set<string>();
		const markers: MarkerVehicle[] = [];
		for (const vehicle of vehicles) {
			const point = busTrackPoint(track, vehicle);
			if (point === null) {
				continue;
			}
			seen.add(vehicle.vehId);
			const next = observe(motion.current.get(vehicle.vehId) ?? null, point);
			motion.current.set(vehicle.vehId, next.state);
			markers.push({
				color,
				key: vehicle.vehId,
				kind: "bus",
				motion: next.state,
				observedPosition: { latitude: vehicle.lat, longitude: vehicle.lng },
				shape: track.shape,
			});
		}
		for (const key of motion.current.keys()) {
			if (!seen.has(key)) {
				motion.current.delete(key);
			}
		}
		return markers;
	}, [track, vehicles, color]);
}

function RouteMap({
	color,
	map,
	markers,
	onPressVehicle,
	selectedVehicleId,
}: {
	color: string;
	map: BusMap;
	markers: MarkerVehicle[];
	onPressVehicle: (key: string) => void;
	selectedVehicleId: string | null;
}) {
	const [first] = map.shape;
	const lines = useMemo(() => {
		const total = cumulativeM(map.shape).at(-1) ?? 0;
		return [
			{
				// 노선 전체를 진하게 그리려고 시작부터 끝까지를 승하차로 넘긴다.
				alightM: total,
				boardM: 0,
				color,
				faintColor: hexWithAlpha(color, FAINT_LINE_OPACITY),
				key: map.line,
				shape: map.shape,
			},
		];
	}, [map, color]);
	if (first === undefined) {
		return null;
	}
	return (
		<View className="overflow-hidden rounded-lg">
			<NaverMapView
				initialCamera={{ latitude: first[1], longitude: first[0], zoom: 13 }}
				isExtentBoundedInKorea
				isShowCompass={false}
				isShowLocationButton={false}
				isShowScaleBar={false}
				isShowZoomControls={false}
				isTiltGesturesEnabled={false}
				locale="ko"
				style={MAP_STYLE}
			>
				<RouteLines legs={lines} />
				<VehicleMarkers
					onPress={onPressVehicle}
					selectedKey={selectedVehicleId}
					smooth
					vehicles={markers}
				/>
			</NaverMapView>
		</View>
	);
}

function StopRow({
	first,
	last,
	onSelect,
	stop,
}: {
	first: boolean;
	last: boolean;
	onSelect: (seq: number) => void;
	stop: BusTimelineStop;
}) {
	const { seq } = stop;
	const select = useCallback(() => onSelect(seq), [onSelect, seq]);
	const trailing =
		stop.status === null && !stop.vehicleHere ? undefined : (
			<View className="flex-row items-center gap-2">
				{stop.vehicleHere ? (
					<BusIcon
						colorClassName="accent-accent-primary"
						size={BUS_ICON_SIZE}
					/>
				) : null}
				{stop.status === null ? null : (
					<AppText variant="bodyMStrong">{stop.status.text}</AppText>
				)}
			</View>
		);
	return (
		<Pressable accessibilityRole="button" onPress={select}>
			<TimelineStop
				first={first}
				last={last}
				name={stop.name}
				state={stop.state}
				trailing={trailing}
			/>
		</Pressable>
	);
}

function VehicleSummary({
	selected,
}: {
	selected: NonNullable<BusRouteModel["selectedVehicle"]>;
}) {
	return (
		<View className="gap-1 rounded-lg bg-bg-surface p-4">
			<View className="flex-row items-center gap-2">
				{selected.plate === null ? null : (
					<AppText variant="bodyMStrong">{selected.plate}</AppText>
				)}
				{selected.lowFloor ? (
					<AppText className="text-text-secondary" variant="caption">
						{t("busDetail.lowFloor")}
					</AppText>
				) : null}
			</View>
			{selected.nextStopName === null ? null : (
				<AppText className="text-text-secondary" variant="bodyS">
					{`${t("busDetail.nextStop")} · ${selected.nextStopName}`}
				</AppText>
			)}
			{selected.status === null || selected.status.text === "" ? null : (
				<AppText variant="bodyS">
					{`${t("busDetail.arrival")} · ${selected.status.text}`}
				</AppText>
			)}
		</View>
	);
}

function Freshness({
	running,
	view,
}: {
	running: number;
	view: BusRouteViewResponse | null;
}) {
	const live = view?.etaState === "live" || (view === null && running > 0);
	return (
		<View className="flex-row items-center gap-3">
			<StatusTag
				kind={live ? "live" : "estimated"}
				label={t(TAG_KEY[live ? "live" : "estimated"])}
			/>
			<AppText className="text-text-secondary" variant="caption">
				{t("busDetail.running", { n: running })}
			</AppText>
		</View>
	);
}

function Timeline({
	model,
	onSelect,
}: {
	model: BusRouteModel;
	onSelect: (seq: number) => void;
}) {
	const lastIndex = model.stops.length - 1;
	return (
		<Section title={t("busDetail.route")}>
			{model.stops.map((stop, index) => (
				<StopRow
					first={index === 0}
					key={stop.seq}
					last={index === lastIndex}
					onSelect={onSelect}
					stop={stop}
				/>
			))}
		</Section>
	);
}

function routeColor(
	route: BusRouteViewResponse["route"] | null,
	mode: ThemeMode
): string {
	return lineColor(
		{
			mode: "bus",
			name: route?.shortName ?? "",
			region: "seoul",
			routeType: route?.routeType ?? "",
		},
		mode
	);
}

/** 방향이 둘 이상일 때만 보인다. 이름이 없는 노선은 방향 칸이 없다. */
function DirectionTabs({
	directions,
	onChange,
	selected,
}: {
	directions: string[];
	onChange: (key: string) => void;
	selected: string | null;
}) {
	const options = useMemo(
		() =>
			directions.map((name) => ({
				key: name,
				label: t("busDetail.direction", { name }),
			})),
		[directions]
	);
	if (directions.length < 2) {
		return null;
	}
	const value =
		selected !== null && directions.includes(selected)
			? selected
			: (directions[0] ?? "");
	return <Segmented onChange={onChange} options={options} value={value} />;
}

function FavoriteStar({
	line,
	route,
}: {
	line: string;
	route: BusRouteViewResponse["route"] | null;
}) {
	const favorites = useSyncExternalStore(
		appFavorites.subscribe,
		appFavorites.get
	);
	// lucide는 color를 stroke에만 써서 fill=currentColor가 검정이 된다. 토큰 색을 직접 넘긴다.
	const starColor = useCSSVariable("--color-icon-primary");
	const favoriteKey = favoriteId({ kind: "route", line });
	const isFavorite = favorites.some((entry) => entry.id === favoriteKey);
	const toggleFavorite = useCallback(() => {
		if (route === null) {
			return;
		}
		appFavorites.toggle({
			addedAt: Date.now(),
			id: favoriteKey,
			kind: "route",
			line,
			name: route.name,
			routeType: route.routeType,
			shortName: route.shortName,
		});
	}, [favoriteKey, line, route]);
	return (
		<IconButton
			accessibilityLabel={t(
				isFavorite ? "busDetail.favoriteRemove" : "busDetail.favorite"
			)}
			onPress={toggleFavorite}
		>
			<Star
				colorClassName="accent-icon-primary"
				fill={isFavorite && typeof starColor === "string" ? starColor : "none"}
				size={STAR_SIZE}
			/>
		</IconButton>
	);
}

/** 07 버스 노선 상세. 노선 모양과 차량, 방면별 운행 경로를 보인다. */
export default function BusRouteDetailScreen() {
	const params = useLocalSearchParams<{
		line: string;
		stop?: string;
		veh?: string;
	}>();
	const { line } = params;
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { isDark } = useAppTheme();
	const visible = useScreenVisible();
	const [selectedDirection, setSelectedDirection] = useState<string | null>(
		null
	);
	const [selectedSeq, setSelectedSeq] = useState<number | null>(
		numberParam(params.stop)
	);
	const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
		params.veh ?? null
	);

	useWatchLine(line, visible);
	const viewQuery = useRouteView(line, visible);
	const snapshot = useBusSnapshot(visible);
	const mapQuery = useQuery({
		queryFn: () => loadRefMap({ line, mode: "bus" }) as Promise<BusMap>,
		queryKey: ["map", "ref", `bus:${line}`],
		staleTime: MAP_REF_STALE_MS,
	});
	const viewResult = viewQuery.data;
	const view = viewResult?.ok ? viewResult.value : null;
	const map = mapQuery.data ?? null;
	const vehicles = snapshot?.vehicles ?? NO_VEHICLES;
	const route = view?.route ?? null;
	const color = useMemo(
		() => routeColor(route, isDark ? "dark" : "light"),
		[route, isDark]
	);

	// 고른 차량은 이 노선 차량 중에서만 찾는다. 스냅샷에서 빠지면 모델이 null을 낸다.
	const model = useMemo(
		() =>
			map === null
				? null
				: busRouteModel({
						map,
						now: Date.now(),
						selectedDirection,
						selectedSeq,
						selectedVehicleId,
						vehicles,
						view,
					}),
		[map, selectedDirection, selectedSeq, selectedVehicleId, vehicles, view]
	);
	const markers = useMarkers(map, vehicles, color);
	const running = model === null ? 0 : markers.length;

	const goBack = useCallback(() => router.back(), [router]);
	const pickDirection = useCallback((key: string) => {
		setSelectedDirection(key);
		setSelectedSeq(null);
	}, []);
	const pickVehicle = useCallback((key: string) => {
		setSelectedVehicleId((current) => (current === key ? null : key));
	}, []);
	// 서버가 모르는 노선(경기·인천 면허 포함)은 400이라 ok가 false다. 받은 적이 있으면 폴링 실패로 지우지 않는다.
	const notFound = viewResult !== undefined && !viewResult.ok && view === null;
	const title =
		route === null ? "" : t("busDetail.title", { shortName: route.shortName });
	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar
				onBack={goBack}
				title={title}
				trailing={<FavoriteStar line={line} route={route} />}
			/>
			<OfflineNotice className="px-4 pb-2" />
			{notFound ? (
				<EmptyState
					body={t("busDetail.unavailable.body")}
					title={t("busDetail.unavailable.title")}
				/>
			) : (
				<ScrollView
					contentContainerStyle={{ paddingBottom: BOTTOM_PADDING }}
					showsVerticalScrollIndicator={false}
				>
					<View className="gap-4 px-4">
						{route === null ? null : (
							<View className="flex-row items-center gap-3">
								<LineBadge
									mode="bus"
									name={route.shortName}
									region="seoul"
									routeType={route.routeType}
								/>
								<AppText className="flex-1" numberOfLines={1} variant="title3">
									{route.name}
								</AppText>
							</View>
						)}
						{map === null ? (
							<AppText className="text-text-secondary" variant="bodyS">
								{t("busDetail.loading")}
							</AppText>
						) : (
							<RouteMap
								color={color}
								map={map}
								markers={markers}
								onPressVehicle={pickVehicle}
								selectedVehicleId={selectedVehicleId}
							/>
						)}
						{model?.selectedVehicle ? (
							<VehicleSummary selected={model.selectedVehicle} />
						) : (
							<>
								<Freshness running={running} view={view} />
								<InlineNotice body={t("busDetail.notice")} />
							</>
						)}
						<DirectionTabs
							directions={model?.directions ?? NO_DIRECTIONS}
							onChange={pickDirection}
							selected={selectedDirection}
						/>
						{model === null ? null : (
							<Timeline model={model} onSelect={setSelectedSeq} />
						)}
					</View>
				</ScrollView>
			)}
		</View>
	);
}

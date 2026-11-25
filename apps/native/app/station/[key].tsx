import {
	NaverMapMarkerOverlay,
	NaverMapView,
} from "@mj-studio/react-native-naver-map";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { StarIcon } from "lucide-react-native";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable, withUniwind } from "uniwind";

import { ArrivalRow } from "@/components/transit/arrival-row";
import { LineBadge } from "@/components/transit/line-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { OfflineNotice } from "@/components/ui/offline-notice";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { TopBar } from "@/components/ui/top-bar";
import { useAppTheme } from "@/contexts/app-theme-context";
import { fetchStationView, STATION_VIEW_MAX } from "@/lib/detail/detail-client";
import {
	type StationDirectionRow,
	stationModel,
} from "@/lib/detail/station-model";
import {
	type StationViewPhase,
	type StationViewSnapshot,
	settleStationView,
	stationPollInterval,
	stationViewAt,
	stationViewPhase,
} from "@/lib/detail/station-view-poll";
import { useNowMs } from "@/lib/detail/use-now-ms";
import { useScreenVisible } from "@/lib/detail/use-screen-visible";
import { appFavorites } from "@/lib/favorites/app-favorites";
import { favoriteId } from "@/lib/favorites/favorites";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import type { SubwayMap } from "@/lib/map/map-client";
import { createMapRefCache } from "@/lib/map/map-client";
import { mapThemeProps } from "@/lib/map/map-theme";
import { loadRefMap, MAP_REF_STALE_MS } from "@/lib/map/use-map-data";
import {
	loadSearchIndex,
	type SearchStation,
} from "@/lib/search/search-client";
import { lineNameKey, stationLineKeys } from "@/lib/search/search-view-model";
import { serverClient } from "@/lib/server/app-server";
import type { EtaStatus } from "@/lib/transit/eta-status";

const Star = withUniwind(StarIcon);

const STAR_SIZE = 22;
const MAP_HEIGHT = 160;
const MARKER_SIZE = 20;
const MAP_ZOOM = 15;
const BOTTOM_PADDING = 16;
/** 수집기 ALL 간격(80초)보다 자주 불러도 상류 호출은 늘지 않는다. */
export const STATION_VIEW_POLL_MS = 15_000;

const stationRefCache = createMapRefCache(Storage);
const MAP_STYLE = { height: MAP_HEIGHT } as const;

const TAG_KEY: Record<EtaStatus["kind"], MessageKey> = {
	ended: "eta.ended",
	estimated: "commute.lock.tag.estimated",
	live: "commute.lock.tag.live",
};

function lineLabel(line: string): string {
	const key = lineNameKey(line);
	return key === null ? line.slice(line.indexOf(":") + 1) : t(key);
}

function StationMap({ lat, lng }: { lat: number; lng: number }) {
	const { isDark } = useAppTheme();
	return (
		<View className="overflow-hidden rounded-lg">
			<NaverMapView
				initialCamera={{ latitude: lat, longitude: lng, zoom: MAP_ZOOM }}
				{...mapThemeProps(isDark)}
				isExtentBoundedInKorea
				isRotateGesturesEnabled={false}
				isScrollGesturesEnabled={false}
				isShowCompass={false}
				isShowLocationButton={false}
				isShowScaleBar={false}
				isShowZoomControls={false}
				isTiltGesturesEnabled={false}
				isZoomGesturesEnabled={false}
				locale="ko"
				style={MAP_STYLE}
			>
				<NaverMapMarkerOverlay
					height={MARKER_SIZE}
					latitude={lat}
					longitude={lng}
					width={MARKER_SIZE}
				>
					<View className="size-5 rounded-full border-2 border-white bg-accent-primary" />
				</NaverMapMarkerOverlay>
			</NaverMapView>
		</View>
	);
}

/** 노선 지도를 받아 노선 ref로 묶는다. 응답이 바뀔 때만 새 객체를 낸다. */
function useLineMaps(lines: string[]): Record<string, SubwayMap> {
	const queries = useQueries({
		queries: lines.map((line) => ({
			queryFn: () => loadRefMap({ line, mode: "subway" }),
			queryKey: ["station-line-map", line],
			staleTime: MAP_REF_STALE_MS,
		})),
	});
	const signature = queries.map((query) => query.dataUpdatedAt).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: 지도 응답이 바뀔 때만(dataUpdatedAt) 다시 만든다.
	return useMemo(() => {
		const byLine: Record<string, SubwayMap> = {};
		lines.forEach((line, index) => {
			const data = queries[index]?.data;
			if (data !== undefined) {
				byLine[line] = data as SubwayMap;
			}
		});
		return byLine;
	}, [lines, signature]);
}

function DirectionRows({
	direction,
	line,
	onOpenTrain,
}: {
	direction: StationDirectionRow;
	line: string;
	onOpenTrain: (trainNo: string, line: string) => void;
}) {
	if (direction.rows.length === 0) {
		return (
			<AppText className="px-4 py-3 text-text-secondary" variant="bodyS">
				{`${direction.directionLabel} · ${t("stationDetail.noArrivals")}`}
			</AppText>
		);
	}
	return direction.rows.map((row) => (
		<ArrivalRow
			eta={row.status.text}
			key={row.key}
			leading={<LineBadge line={line} mode="subway" name={lineLabel(line)} />}
			onPress={
				row.trainNo === null
					? undefined
					: () => onOpenTrain(row.trainNo as string, line)
			}
			status={{ kind: row.status.kind, label: t(TAG_KEY[row.status.kind]) }}
			subtitle={
				row.trainNo === null
					? undefined
					: t("map.sheet.trainNo", { no: row.trainNo })
			}
			title={direction.directionLabel}
		/>
	));
}

function FirstLastRows({
	directions,
	phase,
}: {
	directions: StationDirectionRow[];
	phase: StationViewPhase;
}) {
	if (phase !== "ready") {
		return (
			<AppText className="px-4 py-3 text-text-secondary" variant="bodyS">
				{t(
					phase === "loading"
						? "stationDetail.loading"
						: "stationDetail.unavailable.title"
				)}
			</AppText>
		);
	}
	const hasClock = directions.some(
		(d) => d.firstLabel !== null || d.lastLabel !== null
	);
	if (!hasClock) {
		return (
			<AppText className="px-4 py-3 text-text-secondary" variant="bodyS">
				{t("stationDetail.noService")}
			</AppText>
		);
	}
	return directions.map((direction) => (
		<View
			className="flex-row items-center justify-between px-4 py-3"
			key={direction.key}
		>
			<AppText variant="bodyM">{direction.directionLabel}</AppText>
			<AppText className="text-text-secondary" variant="bodyS">
				{`${t("stationDetail.first")} ${direction.firstLabel ?? "-"} · ${t("stationDetail.last")} ${direction.lastLabel ?? "-"}`}
			</AppText>
		</View>
	));
}

function ArrivalsBody({
	directions,
	failed,
	line,
	loaded,
	onOpenTrain,
	onRetry,
}: {
	directions: StationDirectionRow[];
	failed: boolean;
	line: string;
	loaded: boolean;
	onOpenTrain: (trainNo: string, line: string) => void;
	onRetry: () => void;
}) {
	if (failed) {
		return (
			<EmptyState
				action={
					<AppButton
						label={t("stationDetail.retry")}
						onPress={onRetry}
						size="medium"
						variant="secondary"
					/>
				}
				body={t("stationDetail.unavailable.body")}
				title={t("stationDetail.unavailable.title")}
			/>
		);
	}
	if (!loaded) {
		return (
			<AppText className="px-4 py-3 text-text-secondary" variant="bodyS">
				{t("stationDetail.loading")}
			</AppText>
		);
	}
	return directions.map((direction) => (
		<DirectionRows
			direction={direction}
			key={direction.key}
			line={line}
			onOpenTrain={onOpenTrain}
		/>
	));
}

function StationBody({
	lines,
	onOpenTrain,
	onRetry,
	station,
	viewQuery,
	visible,
}: {
	lines: string[];
	onOpenTrain: (trainNo: string, line: string) => void;
	onRetry: () => void;
	station: SearchStation;
	viewQuery: { data?: StationViewSnapshot };
	visible: boolean;
}) {
	const [picked, setPicked] = useState<string | null>(null);
	const maps = useLineMaps(lines);
	const phase = stationViewPhase(viewQuery.data);
	// 도착은 1초마다 다시 센다. 폴링이 오래 실패하면 마지막 도착판을 추정으로 내리고 지난 열차는 뺀다.
	const now = useNowMs(visible);
	const view = stationViewAt(viewQuery.data, now);
	const models = useMemo(
		() => (view === null ? [] : stationModel(view, maps, now)),
		[view, maps, now]
	);
	const selectedLine =
		picked !== null && lines.includes(picked) ? picked : (lines[0] ?? "");
	const directions = models
		.filter((model) => model.line === selectedLine)
		.flatMap((model) => model.directions);
	return (
		<View className="gap-4 px-4">
			<View className="flex-row gap-1">
				{lines.map((line) => (
					<LineBadge
						key={line}
						line={line}
						mode="subway"
						name={lineLabel(line)}
					/>
				))}
			</View>
			<StationMap lat={station.lat} lng={station.lng} />
			{lines.length > 1 ? (
				<Segmented
					onChange={setPicked}
					options={lines.map((line) => ({
						key: line,
						label: lineLabel(line),
					}))}
					value={selectedLine}
				/>
			) : null}
			<Section
				title={t("stationDetail.arrivals", { line: lineLabel(selectedLine) })}
			>
				<ArrivalsBody
					directions={directions}
					failed={phase === "failed"}
					line={selectedLine}
					loaded={view !== null}
					onOpenTrain={onOpenTrain}
					onRetry={onRetry}
				/>
			</Section>
			<Section title={t("stationDetail.firstLast")}>
				<FirstLastRows directions={directions} phase={phase} />
			</Section>
		</View>
	);
}

/** 08 역 상세. 도착판은 15초마다 다시 받는다. */
export default function StationDetailScreen() {
	const { key } = useLocalSearchParams<{ key: string }>();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const favorites = useSyncExternalStore(
		appFavorites.subscribe,
		appFavorites.get
	);

	const indexQuery = useQuery({
		queryFn: () => loadSearchIndex(serverClient, stationRefCache),
		queryKey: ["search-index"],
		staleTime: MAP_REF_STALE_MS,
	});
	const station = useMemo(
		() => indexQuery.data?.stations.find((entry) => entry.key === key) ?? null,
		[indexQuery.data, key]
	);
	const lines = useMemo(
		() => (station === null ? [] : stationLineKeys(station)),
		[station]
	);
	const queryClient = useQueryClient();
	// 화면이 가려지거나 앱이 뒤로 가면 폴링을 멈춘다.
	const visible = useScreenVisible();
	const viewKey = ["station-view", key];
	const viewQuery = useQuery({
		enabled: station !== null && visible,
		queryFn: async () =>
			settleStationView(
				queryClient.getQueryData<StationViewSnapshot>(viewKey),
				await fetchStationView(
					serverClient,
					station?.members.slice(0, STATION_VIEW_MAX) ?? []
				),
				Date.now()
			),
		queryKey: viewKey,
		refetchInterval: stationPollInterval(visible, STATION_VIEW_POLL_MS),
	});
	// lucide는 color를 stroke에만 써서 fill=currentColor가 검정이 된다. 토큰 색을 직접 넘긴다.
	const starColor = useCSSVariable("--color-icon-primary");

	const goBack = useCallback(() => router.back(), [router]);
	const retry = useCallback(() => {
		viewQuery.refetch();
	}, [viewQuery]);
	const favoriteKey =
		station === null ? "" : favoriteId({ key: station.key, kind: "station" });
	const isFavorite = favorites.some((entry) => entry.id === favoriteKey);
	const toggleFavorite = useCallback(() => {
		if (station === null) {
			return;
		}
		appFavorites.toggle({
			addedAt: Date.now(),
			id: favoriteKey,
			kind: "station",
			members: station.members,
			name: station.name,
		});
	}, [favoriteKey, station]);
	const openTrain = useCallback(
		(trainNo: string, line: string) =>
			router.push(
				`/train/${encodeURIComponent(trainNo)}?line=${encodeURIComponent(line)}` as never
			),
		[router]
	);

	const star = (
		<IconButton
			accessibilityLabel={t(
				isFavorite ? "stationDetail.favoriteRemove" : "stationDetail.favorite"
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

	const notFound = indexQuery.isError || (indexQuery.data && station === null);
	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar onBack={goBack} title={station?.name ?? ""} trailing={star} />
			<OfflineNotice className="px-4 pb-2" />
			<ScrollView
				contentContainerStyle={{ paddingBottom: BOTTOM_PADDING }}
				showsVerticalScrollIndicator={false}
			>
				{notFound ? (
					<EmptyState
						body={t("stationDetail.notFound.body")}
						title={t("stationDetail.notFound.title")}
					/>
				) : null}
				{station === null ? null : (
					<StationBody
						lines={lines}
						onOpenTrain={openTrain}
						onRetry={retry}
						station={station}
						viewQuery={viewQuery}
						visible={visible}
					/>
				)}
			</ScrollView>
			<View
				className="px-4 pt-2"
				style={{ paddingBottom: insets.bottom + BOTTOM_PADDING }}
			>
				<AppButton
					label={t("stationDetail.favorite")}
					onPress={toggleFavorite}
					variant={isFavorite ? "secondary" : "primary"}
				/>
			</View>
		</View>
	);
}

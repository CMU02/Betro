import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { EllipsisIcon, PlusIcon, StarIcon } from "lucide-react-native";
import {
	memo,
	useCallback,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { withUniwind } from "uniwind";

import { ArrivalRow } from "@/components/transit/arrival-row";
import { LineBadge } from "@/components/transit/line-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { OfflineNotice } from "@/components/ui/offline-notice";
import { Screen } from "@/components/ui/screen";
import {
	fetchStationView,
	fetchStopRoutes,
	type StationView,
	type StopRoutes,
} from "@/lib/detail/detail-client";
import { stationModel } from "@/lib/detail/station-model";
import {
	type StationViewSnapshot,
	settleStationView,
	stationPollOptions,
	stationViewAt,
} from "@/lib/detail/station-view-poll";
import { stopModel } from "@/lib/detail/stop-model";
import { useNowMs } from "@/lib/detail/use-now-ms";
import { useScreenVisible } from "@/lib/detail/use-screen-visible";
import { appFavorites } from "@/lib/favorites/app-favorites";
import type { Favorite } from "@/lib/favorites/favorites";
import {
	type FavoritesFilter,
	favoriteHref,
	favoritesBody,
	filterFavorites,
	mergeStationViews,
	stationViewBatches,
	viewForMembers,
} from "@/lib/favorites/favorites-model";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import type { SubwayMap } from "@/lib/map/map-client";
import { loadRefMap, MAP_REF_STALE_MS } from "@/lib/map/use-map-data";
import { appPlaces } from "@/lib/places/app-places";
import type { Place } from "@/lib/places/places";
import { usePlaces } from "@/lib/places/use-places";
import { refStaleTime } from "@/lib/ref/ref-client";
import { lineNameKey } from "@/lib/search/search-view-model";
import { serverClient } from "@/lib/server/app-server";
import type { EtaStatus } from "@/lib/transit/eta-status";

const Plus = withUniwind(PlusIcon);
const Ellipsis = withUniwind(EllipsisIcon);
const EmptyStar = withUniwind(StarIcon);

const ICON_SIZE = 20;
const EMPTY_ICON_SIZE = 40;
/** 수집기 ALL 간격(80초)보다 자주 불러도 상류 호출은 늘지 않는다(역 상세와 같다). */
const STATION_POLL_MS = 15_000;
const SEARCH_HREF = "/search";
const COMMUTE_HREF = "/commute";

const FILTERS: { key: FavoritesFilter; label: MessageKey }[] = [
	{ key: "all", label: "favorites.filter.all" },
	{ key: "station", label: "favorites.filter.station" },
	{ key: "stop", label: "favorites.filter.stop" },
	{ key: "route", label: "favorites.filter.route" },
];

const TAG_KEY: Record<EtaStatus["kind"], MessageKey> = {
	ended: "eta.ended",
	estimated: "commute.lock.tag.estimated",
	live: "commute.lock.tag.live",
};

function lineLabel(line: string): string {
	const key = lineNameKey(line);
	return key === null ? line.slice(line.indexOf(":") + 1) : t(key);
}

function uniqueLines(list: readonly Favorite[]): string[] {
	const lines = new Set<string>();
	for (const favorite of list) {
		if (favorite.kind === "station") {
			for (const member of favorite.members) {
				lines.add(member.line);
			}
		}
	}
	return [...lines];
}

/** 역 카드의 방면 글자에 쓰는 노선 지도. 상세 화면과 같은 참조 캐시를 쓴다. */
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

/** 보이는 역 즐겨찾기의 도착판. 구성 역을 6개씩 나눠 15초마다 묻는다. */
function useStationViews(
	list: readonly Favorite[],
	visible: boolean,
	now: number
): ReturnType<typeof mergeStationViews> {
	const queryClient = useQueryClient();
	const batches = useMemo(() => stationViewBatches(list), [list]);
	const queries = useQueries({
		queries: batches.map((stations) => {
			const queryKey = [
				"favorites-station-view",
				stations.map((entry) => `${entry.line}|${entry.stop}`).join(","),
			];
			return {
				queryFn: async () =>
					settleStationView(
						queryClient.getQueryData<StationViewSnapshot>(queryKey),
						await fetchStationView(serverClient, stations),
						Date.now()
					),
				queryKey,
				...stationPollOptions(visible, STATION_POLL_MS),
			};
		}),
	});
	const snapshots = queries.map((query) => query.data);
	const signature = queries.map((query) => query.dataUpdatedAt).join(",");
	// 묵음은 묶음마다 따로 본다. 한 묶음이 잘 받아도 실패가 이어지는 다른 묶음을 실시간으로 두지 않는다.
	// biome-ignore lint/correctness/useExhaustiveDependencies: 응답이 바뀌거나(dataUpdatedAt) 시각이 지날 때만 다시 합친다.
	return useMemo(() => {
		const views: StationView[] = [];
		for (const snapshot of snapshots) {
			const view = stationViewAt(snapshot, now);
			if (view !== null) {
				views.push(view);
			}
		}
		return mergeStationViews(views);
	}, [signature, now]);
}

interface CardCallbacks {
	onOpen: (favorite: Favorite) => void;
	onRemove: (favorite: Favorite) => void;
}

function CardShell({
	callbacks,
	children,
	favorite,
	leading,
}: {
	callbacks: CardCallbacks;
	children?: React.ReactNode;
	favorite: Favorite;
	leading: React.ReactNode;
}) {
	const { onOpen, onRemove } = callbacks;
	const open = useCallback(() => onOpen(favorite), [onOpen, favorite]);
	const menu = useCallback(
		() =>
			Alert.alert(favorite.name, undefined, [
				{
					onPress: () => onRemove(favorite),
					style: "destructive",
					text: t("favorites.remove"),
				},
				{ style: "cancel", text: t("favorites.cancel") },
			]),
		[onRemove, favorite]
	);
	return (
		<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
			<View className="flex-row items-center gap-2 pr-1 pl-4">
				<Pressable
					accessibilityRole="button"
					className="min-h-12 flex-1 flex-row items-center gap-2"
					onPress={open}
				>
					{leading}
					<AppText className="flex-1" numberOfLines={1} variant="title3">
						{favorite.name}
					</AppText>
				</Pressable>
				<IconButton accessibilityLabel={t("favorites.menu")} onPress={menu}>
					<Ellipsis colorClassName="accent-icon-primary" size={ICON_SIZE} />
				</IconButton>
			</View>
			{children === undefined ? null : (
				// 카드 몸통(도착 행)을 눌러도 같은 상세로 간다. 더보기 버튼은 따로 눌린다.
				<Pressable accessibilityRole="button" onPress={open}>
					{children}
				</Pressable>
			)}
		</View>
	);
}

const StationCard = memo(function StationCardView({
	callbacks,
	favorite,
	maps,
	now,
	view,
}: {
	callbacks: CardCallbacks;
	favorite: Extract<Favorite, { kind: "station" }>;
	maps: Record<string, SubwayMap>;
	now: number;
	view: ReturnType<typeof mergeStationViews>;
}) {
	const models = useMemo(
		() =>
			view === null
				? []
				: stationModel(viewForMembers(view, favorite.members), maps, now),
		[view, favorite.members, maps, now]
	);
	const lines = [...new Set(favorite.members.map((member) => member.line))];
	return (
		<CardShell
			callbacks={callbacks}
			favorite={favorite}
			leading={
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
			}
		>
			{models.flatMap((model) =>
				model.directions.map((direction) => {
					const [first] = direction.rows;
					return first === undefined ? (
						<AppText
							className="px-4 py-3 text-text-secondary"
							key={`${model.line}-${direction.key}`}
							variant="bodyS"
						>
							{`${direction.directionLabel} · ${t("favorites.noArrivals")}`}
						</AppText>
					) : (
						<ArrivalRow
							eta={first.status.text}
							key={`${model.line}-${direction.key}`}
							leading={
								<LineBadge
									line={model.line}
									mode="subway"
									name={lineLabel(model.line)}
								/>
							}
							status={{
								kind: first.status.kind,
								label: t(TAG_KEY[first.status.kind]),
							}}
							title={direction.directionLabel}
						/>
					);
				})
			)}
		</CardShell>
	);
});

const StopCard = memo(function StopCardView({
	callbacks,
	data,
	favorite,
}: {
	callbacks: CardCallbacks;
	data: StopRoutes | null;
	favorite: Extract<Favorite, { kind: "stop" }>;
}) {
	// 배차간격은 정적 자료라 응답을 받을 때의 시각 하나로 계산한다.
	const rows = useMemo(
		() => (data === null ? [] : stopModel(data, Date.now())),
		[data]
	);
	return (
		<CardShell callbacks={callbacks} favorite={favorite} leading={null}>
			{rows.map((row) => (
				<ArrivalRow
					eta={row.status?.text ?? ""}
					key={row.line}
					leading={
						<LineBadge
							mode="bus"
							name={row.shortName}
							region="seoul"
							routeType={row.routeType}
						/>
					}
					status={
						row.status === null
							? { kind: "estimated", label: "" }
							: { kind: row.status.kind, label: t(TAG_KEY[row.status.kind]) }
					}
					title={row.directionLabel ?? row.shortName}
				/>
			))}
		</CardShell>
	);
});

const RouteCard = memo(function RouteCardView({
	callbacks,
	favorite,
}: {
	callbacks: CardCallbacks;
	favorite: Extract<Favorite, { kind: "route" }>;
}) {
	return (
		<CardShell
			callbacks={callbacks}
			favorite={favorite}
			leading={
				<LineBadge
					mode="bus"
					name={favorite.shortName}
					region="seoul"
					routeType={favorite.routeType}
				/>
			}
		/>
	);
});

function PlaceShortcuts({
	onManage,
	onOpen,
	places,
}: {
	onManage: () => void;
	onOpen: (placeId: string) => void;
	places: readonly Place[];
}) {
	if (places.length === 0) {
		return null;
	}
	return (
		<View className="gap-2">
			<View className="flex-row items-center justify-between px-4">
				<AppText className="text-text-secondary" variant="labelS">
					{t("favorites.myPlaces")}
				</AppText>
				<Pressable accessibilityRole="button" onPress={onManage}>
					<AppText className="text-text-secondary" variant="labelS">
						{t("favorites.manage")}
					</AppText>
				</Pressable>
			</View>
			<ScrollView
				contentContainerClassName="gap-2 px-4"
				horizontal
				showsHorizontalScrollIndicator={false}
			>
				{places.map((place) => (
					<PlaceShortcut key={place.id} onOpen={onOpen} place={place} />
				))}
			</ScrollView>
		</View>
	);
}

const PlaceShortcut = memo(function PlaceShortcutView({
	onOpen,
	place,
}: {
	onOpen: (placeId: string) => void;
	place: Place;
}) {
	const open = useCallback(() => onOpen(place.id), [onOpen, place.id]);
	return <Chip label={place.name} onPress={open} selected={false} />;
});

const FilterChip = memo(function FilterChipView({
	filter,
	onPick,
	selected,
}: {
	filter: (typeof FILTERS)[number];
	onPick: (key: FavoritesFilter) => void;
	selected: boolean;
}) {
	const pick = useCallback(() => onPick(filter.key), [onPick, filter.key]);
	return <Chip label={t(filter.label)} onPress={pick} selected={selected} />;
});

/** 09 즐겨찾기 탭. 역은 방향마다 첫 도착, 정류장은 노선마다 배차간격, 노선은 배지와 이름만 보인다. */
export default function FavoritesTab() {
	const router = useRouter();
	const favorites = useSyncExternalStore(
		appFavorites.subscribe,
		appFavorites.get
	);
	const { places } = usePlaces(appPlaces);
	const visible = useScreenVisible();
	const [filter, setFilter] = useState<FavoritesFilter>("all");
	const shown = useMemo(
		() => filterFavorites(favorites, filter),
		[favorites, filter]
	);

	const lines = useMemo(() => uniqueLines(shown), [shown]);
	const maps = useLineMaps(lines);
	// 도착은 1초마다 다시 센다. 폴링이 오래 실패한 묶음은 추정으로 내린다.
	const now = useNowMs(visible);
	const view = useStationViews(shown, visible, now);

	const stops = useMemo(
		() =>
			shown.filter(
				(favorite): favorite is Extract<Favorite, { kind: "stop" }> =>
					favorite.kind === "stop"
			),
		[shown]
	);
	const stopQueries = useQueries({
		queries: stops.map((favorite) => ({
			queryFn: () => fetchStopRoutes(serverClient, favorite.stop),
			queryKey: ["stop-routes", favorite.stop],
			staleTime: refStaleTime,
		})),
	});

	const callbacks = useMemo<CardCallbacks>(
		() => ({
			onOpen: (favorite) => router.push(favoriteHref(favorite) as never),
			onRemove: (favorite) => appFavorites.remove(favorite.id),
		}),
		[router]
	);
	const openSearch = useCallback(() => router.push(SEARCH_HREF), [router]);
	const manage = useCallback(() => router.navigate(COMMUTE_HREF), [router]);
	const openPlace = useCallback(
		(placeId: string) =>
			router.push({ params: { placeId }, pathname: "/commute/[placeId]" }),
		[router]
	);

	const add = (
		<IconButton
			accessibilityLabel={t("favorites.empty.action")}
			onPress={openSearch}
		>
			<Plus colorClassName="accent-icon-primary" size={ICON_SIZE} />
		</IconButton>
	);

	const body = favoritesBody(favorites, shown);
	let stopIndex = 0;
	return (
		<Screen scroll title={t("favorites.title")} titleAction={add}>
			<View className="gap-4 pt-2 pb-4">
				<OfflineNotice className="px-4" />
				<ScrollView
					contentContainerClassName="gap-2 px-4"
					horizontal
					showsHorizontalScrollIndicator={false}
				>
					{FILTERS.map((entry) => (
						<FilterChip
							filter={entry}
							key={entry.key}
							onPick={setFilter}
							selected={filter === entry.key}
						/>
					))}
				</ScrollView>
				<PlaceShortcuts onManage={manage} onOpen={openPlace} places={places} />
				{body === "cards" ? (
					<View className="gap-3 px-4">
						{shown.map((favorite) => {
							if (favorite.kind === "station") {
								return (
									<StationCard
										callbacks={callbacks}
										favorite={favorite}
										key={favorite.id}
										maps={maps}
										now={now}
										view={view}
									/>
								);
							}
							if (favorite.kind === "stop") {
								const result = stopQueries[stopIndex]?.data;
								stopIndex += 1;
								return (
									<StopCard
										callbacks={callbacks}
										data={result?.ok ? result.value : null}
										favorite={favorite}
										key={favorite.id}
									/>
								);
							}
							return (
								<RouteCard
									callbacks={callbacks}
									favorite={favorite}
									key={favorite.id}
								/>
							);
						})}
					</View>
				) : (
					<EmptyState
						action={
							body === "empty" ? (
								<AppButton
									className="w-[200px]"
									label={t("favorites.empty.action")}
									onPress={openSearch}
								/>
							) : undefined
						}
						body={
							body === "empty"
								? t("favorites.empty.body")
								: t("favorites.filteredEmpty")
						}
						icon={
							<EmptyStar
								colorClassName="accent-icon-secondary"
								size={EMPTY_ICON_SIZE}
							/>
						}
						title={t("favorites.empty.title")}
					/>
				)}
			</View>
		</Screen>
	);
}

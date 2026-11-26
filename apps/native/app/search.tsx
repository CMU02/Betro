import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { ChevronLeftIcon, ClockIcon, MapPinIcon } from "lucide-react-native";
import {
	type ReactNode,
	useCallback,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { FlatList, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { LineBadge } from "@/components/transit/line-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { OfflineNotice } from "@/components/ui/offline-notice";
import { TextField } from "@/components/ui/text-field";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import { createMapRefCache } from "@/lib/map/map-client";
import { MAP_REF_STALE_MS } from "@/lib/map/use-map-data";
import { appRecents } from "@/lib/search/app-recents";
import type {
	SearchRoute,
	SearchStation,
	SearchStop,
} from "@/lib/search/search-client";
import { loadSearchIndex } from "@/lib/search/search-client";
import type { SearchScope, SearchTarget } from "@/lib/search/search-model";
import {
	lineNameKey,
	routeTarget,
	searchViewState,
	stationLineKeys,
	stationTarget,
	stopSubtitleKey,
	stopTarget,
	targetHref,
} from "@/lib/search/search-view-model";
import { serverClient } from "@/lib/server/app-server";

const Back = withUniwind(ChevronLeftIcon);
const Pin = withUniwind(MapPinIcon);
const Clock = withUniwind(ClockIcon);

const searchRefCache = createMapRefCache(Storage);

const SCOPES: readonly { key: SearchScope; label: MessageKey }[] = [
	{ key: "all", label: "search.scope.all" },
	{ key: "station", label: "search.scope.station" },
	{ key: "stop", label: "search.scope.stop" },
	{ key: "route", label: "search.scope.route" },
];

const BACK_ICON_SIZE = 22;
const BOTTOM_PADDING = 24;

type Item =
	| { id: string; kind: "header"; title: string; withClear?: boolean }
	| { id: string; kind: "station"; station: SearchStation }
	| { id: string; kind: "stop"; stop: SearchStop }
	| { id: string; kind: "route"; route: SearchRoute }
	| { id: string; kind: "recent"; target: SearchTarget };

function StationRow({
	onOpen,
	station,
}: {
	onOpen: (target: SearchTarget) => void;
	station: SearchStation;
}) {
	const press = useCallback(
		() => onOpen(stationTarget(station)),
		[onOpen, station]
	);
	return (
		<ListRow
			leading={
				<View className="flex-row flex-wrap gap-1">
					{stationLineKeys(station).map((line) => {
						const key = lineNameKey(line);
						return (
							<LineBadge
								key={line}
								line={line}
								mode="subway"
								name={key === null ? line.slice(line.indexOf(":") + 1) : t(key)}
							/>
						);
					})}
				</View>
			}
			onPress={press}
			title={station.name}
			trailing={{ type: "none" }}
		/>
	);
}

function StopRow({
	onOpen,
	stop,
}: {
	onOpen: (target: SearchTarget) => void;
	stop: SearchStop;
}) {
	const press = useCallback(() => onOpen(stopTarget(stop)), [onOpen, stop]);
	const subtitleKey = stopSubtitleKey(stop);
	return (
		<ListRow
			icon={Pin}
			onPress={press}
			subtitle={
				subtitleKey === null
					? undefined
					: t(subtitleKey, {
							arsId: stop.arsId ?? "",
							towards: stop.towards ?? "",
						})
			}
			title={stop.name}
			trailing={{ type: "none" }}
		/>
	);
}

function RouteRow({
	onOpen,
	route,
}: {
	onOpen: (target: SearchTarget) => void;
	route: SearchRoute;
}) {
	const press = useCallback(() => onOpen(routeTarget(route)), [onOpen, route]);
	return (
		<ListRow
			leading={
				<LineBadge
					mode="bus"
					name={route.shortName}
					region="seoul"
					routeType={route.routeType}
				/>
			}
			onPress={press}
			title={route.name}
			trailing={{ type: "none" }}
		/>
	);
}

function RecentRow({
	onOpen,
	target,
}: {
	onOpen: (target: SearchTarget) => void;
	target: SearchTarget;
}) {
	const press = useCallback(() => onOpen(target), [onOpen, target]);
	return (
		<ListRow
			icon={Clock}
			onPress={press}
			title={target.name}
			trailing={{ type: "none" }}
		/>
	);
}

function ScopeChip({
	label,
	onSelect,
	scope,
	selected,
}: {
	label: string;
	onSelect: (scope: SearchScope) => void;
	scope: SearchScope;
	selected: boolean;
}) {
	const press = useCallback(() => onSelect(scope), [onSelect, scope]);
	return <Chip label={label} onPress={press} selected={selected} />;
}

function itemKey(item: Item): string {
	return item.id;
}

function itemsOf(state: ReturnType<typeof searchViewState>): Item[] {
	if (state.kind === "recents") {
		if (state.recents.length === 0) {
			return [];
		}
		return [
			{
				id: "h-recents",
				kind: "header",
				title: t("search.section.recents"),
				withClear: true,
			},
			...state.recents.map((target) => ({
				id: `r-${targetHref(target)}`,
				kind: "recent" as const,
				target,
			})),
		];
	}
	if (state.kind !== "results") {
		return [];
	}
	const { routes, stations, stops } = state.sections;
	const items: Item[] = [];
	if (stations.length > 0) {
		items.push({
			id: "h-stations",
			kind: "header",
			title: t("search.section.stations"),
		});
		for (const station of stations) {
			items.push({ id: `s-${station.key}`, kind: "station", station });
		}
	}
	if (stops.length > 0) {
		items.push({
			id: "h-stops",
			kind: "header",
			title: t("search.section.stops"),
		});
		for (const stop of stops) {
			items.push({ id: `p-${stop.stop}`, kind: "stop", stop });
		}
	}
	if (routes.length > 0) {
		items.push({
			id: "h-routes",
			kind: "header",
			title: t("search.section.routes"),
		});
		for (const route of routes) {
			items.push({ id: `b-${route.line}`, kind: "route", route });
		}
	}
	return items;
}

/** 05 검색. 기기에 받아 둔 색인에서 바로 거른다(설계 결정 4). */
export default function SearchScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<SearchScope>("all");
	const recents = useSyncExternalStore(appRecents.subscribe, appRecents.get);
	const indexQuery = useQuery({
		queryFn: () => loadSearchIndex(serverClient, searchRefCache),
		queryKey: ["search-index"],
		staleTime: MAP_REF_STALE_MS,
	});
	const state = searchViewState({
		failed: indexQuery.isError,
		index: indexQuery.data ?? null,
		query,
		recents,
		scope,
	});
	const items = useMemo(() => itemsOf(state), [state]);

	const goBack = useCallback(() => router.back(), [router]);
	const retry = useCallback(() => {
		indexQuery.refetch();
	}, [indexQuery]);
	const open = useCallback(
		(target: SearchTarget) => {
			appRecents.add(target);
			router.push(targetHref(target) as never);
		},
		[router]
	);
	const clearRecents = useCallback(() => appRecents.clear(), []);

	const renderItem = useCallback(
		({ item }: { item: Item }) => {
			switch (item.kind) {
				case "header":
					return (
						<View className="flex-row items-center justify-between px-4 pt-4 pb-1">
							<AppText className="text-text-secondary" variant="labelM">
								{item.title}
							</AppText>
							{item.withClear ? (
								<AppButton
									label={t("search.clearRecents")}
									onPress={clearRecents}
									size="medium"
									variant="ghost"
								/>
							) : null}
						</View>
					);
				case "station":
					return <StationRow onOpen={open} station={item.station} />;
				case "stop":
					return <StopRow onOpen={open} stop={item.stop} />;
				case "route":
					return <RouteRow onOpen={open} route={item.route} />;
				default:
					return <RecentRow onOpen={open} target={item.target} />;
			}
		},
		[clearRecents, open]
	);

	let body: ReactNode = null;
	if (state.kind === "failed") {
		body = (
			<EmptyState
				action={
					<AppButton
						label={t("search.retry")}
						onPress={retry}
						size="medium"
						variant="secondary"
					/>
				}
				body={t("search.failed.body")}
				title={t("search.failed.title")}
			/>
		);
	} else if (state.kind === "loading") {
		body = (
			<AppText className="px-4 py-6 text-text-secondary" variant="bodyS">
				{t("search.loading")}
			</AppText>
		);
	} else if (state.kind === "empty") {
		body = (
			<EmptyState
				body={t("search.empty.body")}
				title={t("search.empty.title")}
			/>
		);
	}

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<View className="flex-row items-center gap-2 px-4 py-2">
				<IconButton accessibilityLabel={t("search.back")} onPress={goBack}>
					<Back colorClassName="accent-icon-primary" size={BACK_ICON_SIZE} />
				</IconButton>
				<View className="flex-1">
					<TextField
						accessibilityLabel={t("search.placeholder")}
						autoFocus
						onChangeText={setQuery}
						placeholder={t("search.placeholder")}
						returnKeyType="search"
						search={{ clearLabel: t("search.clearText") }}
						value={query}
					/>
				</View>
			</View>
			<OfflineNotice className="px-4 pb-2" />
			<ScrollView
				accessibilityLabel={t("search.scope.label")}
				contentContainerClassName="gap-2 px-4 pb-2"
				horizontal
				keyboardShouldPersistTaps="handled"
				showsHorizontalScrollIndicator={false}
				style={{ flexGrow: 0 }}
			>
				{SCOPES.map((entry) => (
					<ScopeChip
						key={entry.key}
						label={t(entry.label)}
						onSelect={setScope}
						scope={entry.key}
						selected={scope === entry.key}
					/>
				))}
			</ScrollView>
			{body}
			{/* 목록이 키보드 위에서 끝나야 가려진 결과까지 스크롤되고, 끌면 키보드가 내려간다. */}
			<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
				<FlatList
					contentContainerStyle={{
						paddingBottom: insets.bottom + BOTTOM_PADDING,
					}}
					data={items}
					keyboardDismissMode="on-drag"
					keyboardShouldPersistTaps="handled"
					keyExtractor={itemKey}
					renderItem={renderItem}
				/>
			</KeyboardAvoidingView>
		</View>
	);
}

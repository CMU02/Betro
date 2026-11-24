import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { useCallback, useMemo, useRef } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LineBadge } from "@/components/transit/line-badge";
import { TimelineStop } from "@/components/transit/timeline-stop";
import { AppText } from "@/components/ui/app-text";
import { InlineNotice } from "@/components/ui/inline-notice";
import { OfflineNotice } from "@/components/ui/offline-notice";
import { StatusTag } from "@/components/ui/status-tag";
import { TopBar } from "@/components/ui/top-bar";
import { fetchTrip } from "@/lib/detail/detail-client";
import {
	type TrainModel,
	trainModel,
	trainSubtitle,
} from "@/lib/detail/train-model";
import { useScreenVisible } from "@/lib/detail/use-screen-visible";
import { t } from "@/lib/i18n/t";
import {
	createMapRefCache,
	fetchSnapshot,
	type SubwayMap,
	type SubwaySnapshot,
} from "@/lib/map/map-client";
import { freshnessLabel } from "@/lib/map/map-labels";
import { loadRefMap, MAP_REF_STALE_MS } from "@/lib/map/use-map-data";
import { loadSearchIndex } from "@/lib/search/search-client";
import { lineNameKey } from "@/lib/search/search-view-model";
import { serverClient } from "@/lib/server/app-server";

const BOTTOM_PADDING = 16;
const SUBWAY_PREFIX = "seoul-subway:";
/** 수집기 위치 출처 간격보다 자주 받아도 서버는 ETag로 304를 준다. */
const SNAPSHOT_POLL_MS = 10_000;
/** 시간표 열차의 정차는 배치가 바뀌기 전까지 그대로라 자주 다시 받지 않는다. */
const TRIP_STALE_MS = 5 * 60_000;
const NO_NAMES: Record<string, string> = {};

const searchRefCache = createMapRefCache(Storage);

function lineRefOf(line: string | undefined): string {
	if (line === undefined) {
		return "";
	}
	return line.includes(":") ? line : `${SUBWAY_PREFIX}${line}`;
}

function lineLabel(lineRef: string): string {
	const key = lineNameKey(lineRef);
	return key === null ? lineRef.slice(lineRef.indexOf(":") + 1) : t(key);
}

/** 지하철 스냅샷. 304이면 앞서 받은 값을 그대로 둔다. */
function useSubwaySnapshot(visible: boolean): SubwaySnapshot | null {
	const etag = useRef<string | null>(null);
	const last = useRef<SubwaySnapshot | null>(null);
	const query = useQuery({
		queryFn: async () => {
			const result = await fetchSnapshot(serverClient, "subway", etag.current);
			if (result.ok && result.value !== "not-modified") {
				etag.current = result.value.etag;
				last.current = result.value.snapshot as SubwaySnapshot;
			}
			return last.current;
		},
		queryKey: ["train-detail", "snapshot"],
		refetchInterval: visible ? SNAPSHOT_POLL_MS : false,
		staleTime: 0,
	});
	return query.data ?? null;
}

function Header({ lineRef, model }: { lineRef: string; model: TrainModel }) {
	const subtitle = trainSubtitle(model);
	return (
		<View className="gap-3">
			<View className="flex-row items-center gap-3">
				<LineBadge line={lineRef} mode="subway" name={lineLabel(lineRef)} />
				<View className="flex-1 gap-0.5">
					{subtitle === null ? null : (
						<AppText numberOfLines={1} variant="title3">
							{subtitle}
						</AppText>
					)}
					{model.express ? (
						<AppText className="text-text-secondary" variant="caption">
							{t("trainDetail.express")}
						</AppText>
					) : null}
				</View>
			</View>
			{model.freshness === null ? null : (
				<View className="flex-row items-center gap-3">
					<StatusTag {...freshnessLabel(model.freshness)} />
					{model.nextStopName === null ? null : (
						<AppText className="text-text-secondary" variant="caption">
							{`${t("trainDetail.nextStation")} · ${model.nextStopName}`}
						</AppText>
					)}
				</View>
			)}
		</View>
	);
}

function Stops({ stops }: { stops: TrainModel["stops"] }) {
	const lastIndex = stops.length - 1;
	return (
		<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
			{stops.map((stop, index) => (
				<TimelineStop
					first={index === 0}
					// 정차 이름은 순환 노선에서 시종점이 겹칠 수 있어 자리로 구분한다.
					// biome-ignore lint/suspicious/noArrayIndexKey: 위와 같다.
					key={index}
					last={index === lastIndex}
					name={stop.name}
					state={stop.state}
					subtitle={stop.time ?? undefined}
				/>
			))}
		</View>
	);
}

/** 06 열차 상세. 열차 위치와 정차 시각을 보인다. 열차가 스냅샷에서 빠지면 시간표만 보인다. */
export default function TrainDetailScreen() {
	const params = useLocalSearchParams<{ line?: string; trainNo: string }>();
	const { trainNo } = params;
	const lineRef = lineRefOf(params.line);
	const lineKey = lineRef.slice(lineRef.indexOf(":") + 1);
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const visible = useScreenVisible();

	const snapshot = useSubwaySnapshot(visible);
	const mapQuery = useQuery({
		enabled: lineRef !== "",
		queryFn: () =>
			loadRefMap({ line: lineRef, mode: "subway" }) as Promise<SubwayMap>,
		queryKey: ["map", "ref", `subway:${lineRef}`],
		staleTime: MAP_REF_STALE_MS,
	});
	const indexQuery = useQuery({
		queryFn: () => loadSearchIndex(serverClient, searchRefCache),
		queryKey: ["search-index"],
		staleTime: MAP_REF_STALE_MS,
	});

	const vehicle = useMemo(
		() =>
			snapshot?.vehicles.find(
				(entry) => entry.rawTrainNo === trainNo && entry.lineKey === lineKey
			) ?? null,
		[snapshot, trainNo, lineKey]
	);
	// 열차가 스냅샷에서 빠져도 한 번 안 시간표 열차는 계속 보여 준다.
	const tripIdRef = useRef<number | null>(null);
	const seenTripId = vehicle?.tripId ?? null;
	if (seenTripId !== null) {
		tripIdRef.current = seenTripId;
	}
	const tripId = tripIdRef.current;
	const tripQuery = useQuery({
		enabled: tripId !== null,
		queryFn: () => fetchTrip(serverClient, tripId as number),
		queryKey: ["train-detail", "trip", tripId],
		staleTime: TRIP_STALE_MS,
	});
	const trip = tripQuery.data?.ok ? tripQuery.data.value : null;

	const stationsById = useMemo(() => {
		if (indexQuery.data === undefined) {
			return NO_NAMES;
		}
		const names: Record<string, string> = {};
		for (const station of indexQuery.data.stations) {
			for (const member of station.members) {
				names[member.stop.slice(member.stop.indexOf(":") + 1)] = station.name;
			}
		}
		return names;
	}, [indexQuery.data]);

	const map = mapQuery.data ?? null;
	const model = useMemo(
		() =>
			map === null
				? null
				: trainModel({ map, now: Date.now(), stationsById, trip, vehicle }),
		[map, stationsById, trip, vehicle]
	);

	const goBack = useCallback(() => router.back(), [router]);
	// 스냅샷을 한 번도 받지 못했으면 아직 모르는 것이라 "받지 못했어요"를 내지 않는다.
	const gone = model !== null && snapshot !== null && model.stops.length === 0;
	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar onBack={goBack} title={t("trainDetail.title", { trainNo })} />
			<OfflineNotice className="px-4 pb-2" />
			<ScrollView
				contentContainerStyle={{ paddingBottom: BOTTOM_PADDING }}
				showsVerticalScrollIndicator={false}
			>
				<View className="gap-4 px-4">
					{model === null ? null : <Header lineRef={lineRef} model={model} />}
					{gone ? (
						<InlineNotice body={t("trainDetail.gone")} tone="alert" />
					) : (
						<InlineNotice body={t("trainDetail.notice")} />
					)}
					{model === null ||
					model.hasTimetable ||
					model.stops.length === 0 ? null : (
						<AppText className="text-text-secondary" variant="caption">
							{t("trainDetail.noTimetable")}
						</AppText>
					)}
					{model === null ? null : <Stops stops={model.stops} />}
				</View>
			</ScrollView>
		</View>
	);
}

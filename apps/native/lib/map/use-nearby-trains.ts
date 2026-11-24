import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { serverClient } from "@/lib/server/app-server";

import { appMotionMetrics } from "./app-motion-metrics";
import { estimatedModeOf } from "./estimated-mode";
import {
	fetchSnapshot,
	fetchSubwayStations,
	type SubwayMap,
	type SubwaySnapshot,
} from "./map-client";
import {
	createSubwayTrack,
	type MotionState,
	observe,
	pointAlong,
	type SubwayTrack,
	subwayTrackPoint,
} from "./motion";
import { type Coordinate, NEARBY_RADIUS_M, nearbyLines } from "./nearby";
import { branchForTrain, trainsNear, trainsOnLines } from "./nearby-trains";
import {
	loadRefMap,
	MAP_REF_STALE_MS,
	refKey,
	SNAPSHOT_INTERVAL_MS,
	useVisiblePoll,
} from "./use-map-data";
import { useMapVisible } from "./use-map-visible";

/**
 * 근처 노선을 이 개수까지만 그린다. 도심에서는 반경 안에 노선이 대여섯 개라 열차 마커가 백 대를 넘고,
 * 마커마다 그림을 따로 그리는 지도 SDK가 느려진다. 가까운 노선부터 고른다.
 */
const NEARBY_MAX_LINES = 3;
/**
 * 내 위치에서 이 거리 안의 열차만 그린다. 근처 노선이어도 화면 밖 열차는 그리지 않는다(지도 설계 4.2).
 * 내 위치로 옮기는 카메라(확대 14)가 휴대폰 화면에 담는 범위쯤이다.
 */
const NEARBY_TRAIN_RADIUS_M = 4000;
/** 역 좌표 목록은 하루 단위로 바뀐다. */
const STATIONS_STALE_MS = 60 * 60 * 1000;

export interface NearbyPath {
	key: string;
	line: string;
	shape: SubwayTrack["shape"];
}

export interface NearbyTrain {
	id: string;
	line: string;
	motion: MotionState;
	/** 마지막 관측 위치(움직임 보정 없이). */
	observedPosition: { bearing: number; latitude: number; longitude: number };
	shape: SubwayTrack["shape"];
}

interface LineTracks {
	line: string;
	map: SubwayMap;
	tracks: Map<string, SubwayTrack>;
}

function tracksOf(line: string, map: SubwayMap): LineTracks {
	const tracks = new Map<string, SubwayTrack>();
	for (const branch of map.branches) {
		const track = createSubwayTrack(branch);
		if (track !== null) {
			tracks.set(branch.branchKey, track);
		}
	}
	return { line, map, tracks };
}

/** 한 노선 열차들의 새 관측을 움직임에 이어 붙인다. 7.2 지표는 상태가 바뀐 갱신만 센다. */
function advanceLine(
	{ line, map, tracks }: LineTracks,
	snapshot: SubwaySnapshot | null,
	states: Map<string, MotionState>,
	seen: Set<string>
): NearbyTrain[] {
	const next: NearbyTrain[] = [];
	for (const vehicle of trainsOnLines(snapshot?.vehicles ?? [], [line])) {
		const branch = branchForTrain(map, vehicle);
		const track = branch === null ? undefined : tracks.get(branch.branchKey);
		const point = track === undefined ? null : subwayTrackPoint(track, vehicle);
		if (track === undefined || point === null) {
			continue;
		}
		const key = `${line}:${vehicle.direction}:${vehicle.rawTrainNo}`;
		seen.add(key);
		const previous = states.get(key) ?? null;
		const observed = observe(previous, point, Date.now());
		if (observed.state !== previous) {
			states.set(key, observed.state);
			appMotionMetrics.record(observed.violation);
		}
		const at = pointAlong(track.shape, observed.state.observedDistanceM);
		if (at !== null) {
			next.push({
				id: key,
				line,
				motion: observed.state,
				observedPosition: at,
				shape: track.shape,
			});
		}
	}
	return next;
}

async function loadStations() {
	const result = await fetchSubwayStations(serverClient);
	if (!result.ok) {
		throw new Error(`subway stations unavailable: ${result.reason}`);
	}
	return result.value;
}

/**
 * 장소가 없을 때 내 위치 근처 지하철 노선의 열차(지도 설계 2.5). 근처 노선은 기기에서 고르고,
 * 서버에는 노선 ref로 참조 지도만 받는다. 위치는 보내지 않는다. 폴링은 지도가 보일 때만 돈다(4.5).
 */
export function useNearbyTrains(here: Coordinate | null): {
	/** 근처 지하철이 시간표 추정 모드인가(14). */
	estimatedMode: boolean;
	paths: NearbyPath[];
	trains: NearbyTrain[];
} {
	const visible = useMapVisible();
	const stations = useQuery({
		enabled: here !== null,
		queryFn: loadStations,
		queryKey: ["map", "subway-stations"],
		staleTime: STATIONS_STALE_MS,
	});
	const lines = useMemo(
		() =>
			here === null || stations.data === undefined
				? []
				: nearbyLines(stations.data, here, NEARBY_RADIUS_M).slice(
						0,
						NEARBY_MAX_LINES
					),
		[here, stations.data]
	);

	const refQueries = useQueries({
		queries: lines.map((line) => ({
			queryFn: () => loadRefMap({ line, mode: "subway" }),
			queryKey: ["map", "ref", refKey({ line, mode: "subway" })],
			staleTime: MAP_REF_STALE_MS,
		})),
	});
	const refDataKey = refQueries.map((query) => query.dataUpdatedAt).join(",");
	const refMaps = refQueries.map((query) => query.data ?? null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: refMaps는 매 렌더 새 배열이라 갱신 시각(refDataKey)을 키로 쓴다.
	const lineTracks = useMemo(
		() =>
			lines.flatMap((line, index) => {
				const map = refMaps[index];
				return map && "branches" in map ? [tracksOf(line, map)] : [];
			}),
		[lines, refDataKey]
	);

	const polling = visible && lines.length > 0;
	const [snapshot, setSnapshot] = useState<SubwaySnapshot | null>(null);
	const etag = useRef<string | null>(null);
	useVisiblePoll(
		polling,
		`nearby-snapshot:${lines.join(",")}`,
		SNAPSHOT_INTERVAL_MS,
		async () => {
			const result = await fetchSnapshot(serverClient, "subway", etag.current);
			if (!result.ok || result.value === "not-modified") {
				return;
			}
			etag.current = result.value.etag;
			setSnapshot(result.value.snapshot as SubwaySnapshot);
		}
	);

	// 304가 이어지면 스냅샷이 바뀌지 않으므로, 보이는 동안 폴링 간격마다 시각을 새로 읽어 추정 모드를 다시 센다.
	const [nowMs, setNowMs] = useState(Date.now);
	useEffect(() => {
		if (!polling) {
			return;
		}
		setNowMs(Date.now());
		const timer = setInterval(() => setNowMs(Date.now()), SNAPSHOT_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [polling]);
	const estimatedMode =
		lines.length > 0 &&
		estimatedModeOf({
			bus: null,
			busRouteIds: [],
			now: nowMs,
			subway: snapshot,
		}).subway;

	// 관측이 들어오면 열차별 움직임을 이어 간다. 스냅샷에서 빠진 열차는 버린다.
	const motion = useRef(new Map<string, MotionState>());
	const [trains, setTrains] = useState<NearbyTrain[]>([]);
	useEffect(() => {
		const seen = new Set<string>();
		const next = lineTracks.flatMap((lineTrack) =>
			advanceLine(lineTrack, snapshot, motion.current, seen)
		);
		for (const key of motion.current.keys()) {
			if (!seen.has(key)) {
				motion.current.delete(key);
			}
		}
		setTrains(next);
	}, [lineTracks, snapshot]);

	const paths = useMemo(
		() =>
			lineTracks.flatMap(({ line, tracks }) =>
				[...tracks.entries()].map(([branchKey, track]) => ({
					key: `${line}:${branchKey}`,
					line,
					shape: track.shape,
				}))
			),
		[lineTracks]
	);

	const shown = useMemo(
		() =>
			here === null ? [] : trainsNear(trains, here, NEARBY_TRAIN_RADIUS_M),
		[here, trains]
	);

	return { estimatedMode, paths, trains: shown };
}

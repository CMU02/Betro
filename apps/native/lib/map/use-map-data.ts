import type { BusLeg, Leg, Route, SubwayLeg } from "@Betro/commute/plan";
import { useQueries } from "@tanstack/react-query";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
	ActiveSessionView,
	SessionRouteView,
} from "@/lib/commute/session-client";
import { useActiveSession } from "@/lib/commute/use-active-session";
import type { Place } from "@/lib/places/places";
import { usePreferences } from "@/lib/preferences/use-preferences";
import { serverClient } from "@/lib/server/app-server";

import { appMotionMetrics } from "./app-motion-metrics";
import { legSpanM } from "./leg-span";
import {
	allLinesHidden,
	boardedVehicleId,
	busVehiclesForLeg,
	subwayVehiclesForLeg,
	visibleLegs,
} from "./leg-vehicles";
import {
	type BusMap,
	type BusSnapshot,
	type BusSnapshotVehicle,
	createMapRefCache,
	fetchBusMap,
	fetchSnapshot,
	fetchSubwayMap,
	loadCachedRef,
	postRouteView,
	postWatch,
	type RouteView,
	type SubwayMap,
	type SubwaySnapshot,
	type SubwaySnapshotVehicle,
} from "./map-client";
import {
	type BusTrack,
	busTrackPoint,
	createBusTrack,
	createSubwayTrack,
	type MotionState,
	observe,
	pointAlong,
	positionAt,
	type SubwayTrack,
	subwayTrackPoint,
	type TrackPoint,
} from "./motion";
import { createPoller } from "./polling";
import type { MapSelection } from "./selection";
import { viewFromSession } from "./session-view";
import { useMapVisible } from "./use-map-visible";

/** 스냅샷 폴링 간격. 서버 `max-age=10`과 맞춘다. */
export const SNAPSHOT_INTERVAL_MS = 10_000;
/** 관측 요청 하트비트 간격. 서버 TTL(90초)보다 짧게 둔다. */
const HEARTBEAT_INTERVAL_MS = 60_000;
/** 경로 보기 간격. */
const ROUTE_VIEW_INTERVAL_MS = 15_000;
/** 마커 위치를 다시 계산하는 간격. */
export const RENDER_TICK_MS = 1000;
/** 참조 데이터(노선 선, 정류장)는 하루 단위로 바뀐다. */
export const MAP_REF_STALE_MS = 10 * 60 * 1000;
const SEOUL_BUS_PREFIX = "seoul-bus:";

const mapRefCache = createMapRefCache(Storage);

export interface RenderVehicle {
	/** 1초마다 계산한 표시 위치의 진행 방향. */
	bearing: number;
	id: string;
	kind: "bus" | "subway";
	lastSeenAt: number;
	/** 1초마다 계산한 표시 위치. 프레임마다 다시 계산하려면 `motion`과 `MapLeg.track.shape`를 쓴다. */
	latitude: number;
	legIndex: number;
	longitude: number;
	/** 차량 움직임 상태. `positionAt(motion, now)`와 `pointAlong(track.shape, …)`으로 프레임마다 위치를 낸다. */
	motion: MotionState;
	observedAt: number;
	/** 마지막 관측 위치(움직임 보정 없이). `smoothVehicleMotion`이 꺼졌을 때 여기로 바로 옮긴다. */
	observedPosition: { bearing: number; latitude: number; longitude: number };
	/** 버스는 `sectOrd`, 지하철은 역 `statnId`에 해당하는 순번. 모르면 null. */
	positionSeq: number | null;
	/** 지하철 역 ID(`statnId`)와 진입·도착 상태. 버스는 null. */
	statnId: string | null;
	status: SubwaySnapshotVehicle["status"];
}

export interface MapLeg {
	/** 승차·하차 위치(선 시작에서 잰 미터). 선에서 이 사이를 진하게 그린다. 모르면 null. */
	alightM: number | null;
	boardM: number | null;
	leg: Leg;
	/** 이 구간 노선의 참조 지도와 거리 선. 받기 전이거나 못 받았으면 null. */
	map: BusMap | SubwayMap | null;
	shape: [number, number][];
	showVehicles: boolean;
	track: BusTrack | SubwayTrack | null;
	vehicles: RenderVehicle[];
}

export interface MapData {
	allHidden: boolean;
	legs: MapLeg[];
	route: Route | null;
	smoothVehicleMotion: boolean;
	source: "session" | "route-view";
	view: RouteView | null;
}

type SubwayBranch = SubwayMap["branches"][number];

type LegTrack =
	| { kind: "bus"; map: BusMap; track: BusTrack }
	| {
			branch: SubwayBranch;
			kind: "subway";
			map: SubwayMap;
			track: SubwayTrack;
	  };

interface Snapshots {
	bus: BusSnapshot | null;
	subway: SubwaySnapshot | null;
}

type RefMap = BusMap | SubwayMap | null;

/** 참조 지도를 고르는 값. 노선 ref(`seoul-subway:line2`)와 종류다. */
export interface MapLineRef {
	line: string;
	mode: Leg["mode"];
}

export function refKey(leg: MapLineRef): string {
	return `${leg.mode}:${leg.line}`;
}

/** 기기 저장본을 먼저 읽고 서버 ETag로 바뀐 때만 다시 받는다. 받지 못하고 저장본도 없으면 던져 다시 시도하게 한다. */
export function loadRefMap(leg: MapLineRef): Promise<BusMap | SubwayMap> {
	const bareLine = leg.line.slice(leg.line.indexOf(":") + 1);
	if (leg.mode === "bus") {
		return loadCachedRef<BusMap>(mapRefCache, refKey(leg), (etag) =>
			fetchBusMap(serverClient, bareLine, etag)
		);
	}
	return loadCachedRef<SubwayMap>(mapRefCache, refKey(leg), (etag) =>
		fetchSubwayMap(serverClient, bareLine, etag)
	);
}

/** 구간 방향의 가지 중 승차역(가능하면 하차역도)을 지나는 것. */
function subwayBranch(leg: SubwayLeg, map: SubwayMap): SubwayBranch | null {
	const candidates = map.branches.filter(
		(branch) =>
			branch.direction === leg.direction &&
			branch.stations.some((station) => station.stop === leg.board.stop)
	);
	return (
		candidates.find((branch) =>
			branch.stations.some((station) => station.stop === leg.alight.stop)
		) ??
		candidates[0] ??
		null
	);
}

function buildLegTrack(leg: Leg, map: RefMap): LegTrack | null {
	if (map === null) {
		return null;
	}
	if (leg.mode === "bus") {
		const busMap = map as BusMap;
		const track = createBusTrack(busMap);
		return track === null ? null : { kind: "bus", map: busMap, track };
	}
	const subwayMap = map as SubwayMap;
	const branch = subwayBranch(leg, subwayMap);
	const track = branch === null ? null : createSubwayTrack(branch);
	return track === null || branch === null
		? null
		: { branch, kind: "subway", map: subwayMap, track };
}

function activeSessionFor(
	place: Place | null,
	route: Route | null,
	session: ActiveSessionView | null
): SessionRouteView | null {
	if (place === null || route === null || session === null) {
		return null;
	}
	if (session.planId !== place.plan.planId) {
		return null;
	}
	return session.routes.find((entry) => entry.rank === route.rank) ?? null;
}

function trackPointFor(
	legTrack: LegTrack,
	vehicle: BusSnapshotVehicle | SubwaySnapshotVehicle
): TrackPoint | null {
	if (legTrack.kind === "bus") {
		return busTrackPoint(legTrack.track, vehicle as BusSnapshotVehicle);
	}
	return subwayTrackPoint(legTrack.track, vehicle as SubwaySnapshotVehicle);
}

function vehicleIdOf(vehicle: BusSnapshotVehicle | SubwaySnapshotVehicle) {
	return "vehId" in vehicle ? vehicle.vehId : vehicle.rawTrainNo;
}

function legVehicles(
	leg: Leg,
	legTrack: LegTrack,
	snapshots: Snapshots,
	boardedId: string | null
): (BusSnapshotVehicle | SubwaySnapshotVehicle)[] {
	if (leg.mode === "bus" && legTrack.kind === "bus") {
		return busVehiclesForLeg(
			leg as BusLeg,
			snapshots.bus?.vehicles ?? [],
			boardedId,
			legTrack.map
		);
	}
	if (leg.mode === "subway" && legTrack.kind === "subway") {
		return subwayVehiclesForLeg(
			leg as SubwayLeg,
			snapshots.subway?.vehicles ?? [],
			legTrack.map,
			boardedId
		);
	}
	return [];
}

function positionSeqOf(
	legTrack: LegTrack,
	vehicle: BusSnapshotVehicle | SubwaySnapshotVehicle
): number | null {
	if (legTrack.kind === "bus") {
		return (vehicle as BusSnapshotVehicle).sectOrd;
	}
	const { statnId } = vehicle as SubwaySnapshotVehicle;
	if (statnId === null) {
		return null;
	}
	const stop = `seoul-subway:${statnId}`;
	return (
		legTrack.branch.stations.find((station) => station.stop === stop)?.seq ??
		null
	);
}

/** 탑승이 판정된 구간만 차량 하나로 좁힌다. 그 밖에는 다가오는 차량을 모두 그린다. */
function boardedFor(
	route: Route | null,
	sessionRoute: SessionRouteView | null,
	session: ActiveSessionView | null,
	legIndex: number
): string | null {
	if (route === null || sessionRoute === null || session === null) {
		return null;
	}
	return boardedVehicleId({
		currentLegIndex: session.content.legIndex,
		legIndex,
		rank: route.rank,
		stage: session.content.stage,
		vehicleId: sessionRoute.legVehicleIds[legIndex] ?? null,
	});
}

function renderVehicle(
	legTrack: LegTrack,
	vehicle: BusSnapshotVehicle | SubwaySnapshotVehicle,
	legIndex: number,
	state: MotionState,
	nowMs: number
): RenderVehicle | null {
	const at = pointAlong(legTrack.track.shape, positionAt(state, nowMs));
	const observed = pointAlong(legTrack.track.shape, state.observedDistanceM);
	if (at === null || observed === null) {
		return null;
	}
	const subway = "rawTrainNo" in vehicle ? vehicle : null;
	return {
		bearing: at.bearing,
		id: vehicleIdOf(vehicle),
		kind: legTrack.kind,
		lastSeenAt: vehicle.lastSeenAt,
		latitude: at.latitude,
		legIndex,
		longitude: at.longitude,
		motion: state,
		observedAt: vehicle.observedAt,
		observedPosition: observed,
		positionSeq: positionSeqOf(legTrack, vehicle),
		statnId: subway?.statnId ?? null,
		status: subway?.status ?? null,
	};
}

function renderLeg(args: {
	boardedId: string | null;
	leg: Leg;
	legIndex: number;
	legTrack: LegTrack | null;
	motionStates: ReadonlyMap<string, MotionState>;
	nowMs: number;
	showVehicles: boolean;
	snapshots: Snapshots;
}): MapLeg {
	const { boardedId, leg, legIndex, legTrack, nowMs, showVehicles } = args;
	const vehicles: RenderVehicle[] = [];
	if (showVehicles && legTrack !== null) {
		for (const vehicle of legVehicles(
			leg,
			legTrack,
			args.snapshots,
			boardedId
		)) {
			const state = args.motionStates.get(
				`${legIndex}:${vehicleIdOf(vehicle)}`
			);
			const rendered =
				state === undefined
					? null
					: renderVehicle(legTrack, vehicle, legIndex, state, nowMs);
			if (rendered !== null) {
				vehicles.push(rendered);
			}
		}
	}
	return {
		...legSpanM(leg, legTrack),
		leg,
		map: legTrack?.map ?? null,
		shape: trackShape(legTrack),
		showVehicles,
		track: legTrack?.track ?? null,
		vehicles,
	};
}

function trackShape(legTrack: LegTrack | null): [number, number][] {
	return legTrack === null ? [] : [...legTrack.track.shape];
}

/** 보일 때만 폴링하는 하트비트·스냅샷·경로 보기를 묶는다. 위치는 서버에 보내지 않고 노선 ref만 보낸다. */
export function useVisiblePoll(
	visible: boolean,
	key: string,
	intervalMs: number,
	run: () => Promise<void>
): void {
	const runRef = useRef(run);
	runRef.current = run;
	// biome-ignore lint/correctness/useExhaustiveDependencies: key가 바뀔 때만 폴러를 새로 만든다. run은 ref로 읽는다.
	useEffect(() => {
		const poller = createPoller({
			intervalMs,
			now: Date.now,
			run: () => runRef.current(),
			schedule: (fn, ms) => {
				const timer = setTimeout(fn, ms);
				return () => clearTimeout(timer);
			},
		});
		poller.setVisible(visible);
		return () => poller.dispose();
	}, [visible, key, intervalMs]);
}

export function useMapData(
	selection: MapSelection | null,
	places: readonly Place[]
): MapData {
	const visible = useMapVisible();
	const [preferences] = usePreferences();
	const { state: sessionState } = useActiveSession();

	const place =
		places.find((candidate) => candidate.id === selection?.placeId) ?? null;
	const route =
		place?.plan.routes.find(
			(candidate) => candidate.rank === selection?.rank
		) ?? null;
	const session = sessionState?.session ?? null;
	const sessionRoute = activeSessionFor(place, route, session);
	const source = sessionRoute === null ? "route-view" : "session";
	const hiddenLines = preferences.hiddenMapLines;

	const legsWithFlags = useMemo(
		() => (route === null ? [] : visibleLegs(route, hiddenLines)),
		[route, hiddenLines]
	);
	const allHidden = route !== null && allLinesHidden(route, hiddenLines);

	const refQueries = useQueries({
		queries: legsWithFlags.map(({ leg }) => ({
			queryFn: () => loadRefMap(leg),
			queryKey: ["map", "ref", refKey(leg)],
			staleTime: MAP_REF_STALE_MS,
		})),
	});
	const refMaps = refQueries.map((query) => query.data ?? null);
	const refDataKey = refQueries.map((query) => query.dataUpdatedAt).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: refMaps는 매 렌더 새 배열이라 갱신 시각(refDataKey)을 키로 쓴다.
	const legTracks = useMemo(
		() =>
			legsWithFlags.map(({ leg }, index) =>
				buildLegTrack(leg, refMaps[index] ?? null)
			),
		[legsWithFlags, refDataKey]
	);

	// 경로 보기. 세션이 따르는 경로면 세션 값을 쓴다(지도 설계 4.6).
	const [routeView, setRouteView] = useState<RouteView | null>(null);
	const routeKey = route === null ? "" : JSON.stringify(route);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 경로가 바뀌면 이전 경로의 보기를 버린다.
	useEffect(() => {
		setRouteView(null);
	}, [routeKey]);
	useVisiblePoll(
		visible && route !== null && source === "route-view",
		`route-view:${routeKey}`,
		ROUTE_VIEW_INTERVAL_MS,
		async () => {
			if (route === null) {
				return;
			}
			const result = await postRouteView(serverClient, route);
			if (result.ok) {
				setRouteView(result.value);
			}
		}
	);
	const view = useMemo(() => {
		if (route === null) {
			return null;
		}
		if (sessionRoute !== null && session !== null) {
			return viewFromSession(route, sessionRoute, session.content);
		}
		return routeView;
	}, [route, sessionRoute, session, routeView]);

	// 하트비트. 이 경로 버스 노선의 seoul-bus ref만 보낸다.
	const watchRefs = useMemo(
		() =>
			route === null
				? []
				: [
						...new Set(
							route.legs
								.filter(
									(leg) =>
										leg.mode === "bus" && leg.line.startsWith(SEOUL_BUS_PREFIX)
								)
								.map((leg) => leg.line)
						),
					],
		[route]
	);
	useVisiblePoll(
		visible && watchRefs.length > 0,
		`watch:${watchRefs.join(",")}`,
		HEARTBEAT_INTERVAL_MS,
		async () => {
			await postWatch(serverClient, watchRefs);
		}
	);

	// 스냅샷. 차량을 보일 구간이 있는 종류만 받는다.
	const [snapshots, setSnapshots] = useState<Snapshots>({
		bus: null,
		subway: null,
	});
	const etags = useRef<{ bus: string | null; subway: string | null }>({
		bus: null,
		subway: null,
	});
	const kinds = useMemo(() => {
		const wanted = new Set<"bus" | "subway">();
		for (const { leg, showVehicles } of legsWithFlags) {
			if (showVehicles) {
				wanted.add(leg.mode);
			}
		}
		return [...wanted].sort();
	}, [legsWithFlags]);
	useVisiblePoll(
		visible && kinds.length > 0,
		`snapshot:${kinds.join(",")}`,
		SNAPSHOT_INTERVAL_MS,
		async () => {
			await Promise.all(
				kinds.map(async (kind) => {
					const result = await fetchSnapshot(
						serverClient,
						kind,
						etags.current[kind]
					);
					if (!result.ok || result.value === "not-modified") {
						return;
					}
					etags.current[kind] = result.value.etag;
					const { snapshot } = result.value;
					setSnapshots((previous) => ({ ...previous, [kind]: snapshot }));
				})
			);
		}
	);

	// 관측이 들어오면 차량별 움직임을 이어 간다. 7.2 지표는 상태가 바뀐 갱신만 센다.
	const motion = useRef(new Map<string, MotionState>());
	const [motionVersion, setMotionVersion] = useState(0);
	useEffect(() => {
		const seen = new Set<string>();
		legsWithFlags.forEach(({ leg, showVehicles }, legIndex) => {
			const legTrack = legTracks[legIndex];
			if (!(showVehicles && legTrack)) {
				return;
			}
			const boarded = boardedFor(route, sessionRoute, session, legIndex);
			for (const vehicle of legVehicles(leg, legTrack, snapshots, boarded)) {
				const key = `${legIndex}:${vehicleIdOf(vehicle)}`;
				seen.add(key);
				const point = trackPointFor(legTrack, vehicle);
				if (point === null) {
					continue;
				}
				const previous = motion.current.get(key) ?? null;
				const next = observe(previous, point, Date.now());
				if (next.state !== previous) {
					motion.current.set(key, next.state);
					appMotionMetrics.record(next.violation);
				}
			}
		});
		// 다른 경로로 바뀌거나 스냅샷에서 빠진 차량은 상태를 버린다. 관측이 빠졌을 때는 마지막 자리에 머문다.
		for (const key of motion.current.keys()) {
			if (!seen.has(key)) {
				motion.current.delete(key);
			}
		}
		setMotionVersion((value) => value + 1);
	}, [snapshots, legTracks, legsWithFlags, route, sessionRoute, session]);

	// 보이는 동안 1초마다 위치를 다시 계산한다.
	const [nowMs, setNowMs] = useState(Date.now);
	useEffect(() => {
		if (!visible) {
			return;
		}
		setNowMs(Date.now());
		const timer = setInterval(() => setNowMs(Date.now()), RENDER_TICK_MS);
		return () => clearInterval(timer);
	}, [visible]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: motionVersion이 ref 안 상태의 변경을 알린다.
	const legs = useMemo<MapLeg[]>(
		() =>
			legsWithFlags.map(({ leg, showVehicles }, legIndex) =>
				renderLeg({
					boardedId: boardedFor(route, sessionRoute, session, legIndex),
					leg,
					legIndex,
					legTrack: legTracks[legIndex] ?? null,
					motionStates: motion.current,
					nowMs,
					showVehicles,
					snapshots,
				})
			),
		[
			legsWithFlags,
			legTracks,
			snapshots,
			route,
			sessionRoute,
			session,
			nowMs,
			motionVersion,
		]
	);

	return {
		allHidden,
		legs,
		route,
		smoothVehicleMotion: preferences.smoothVehicleMotion,
		source,
		view,
	};
}

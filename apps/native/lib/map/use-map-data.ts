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
import {
	allLinesHidden,
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
import { useMapVisible } from "./use-map-visible";

/** 스냅샷 폴링 간격. 서버 `max-age=10`과 맞춘다. */
const SNAPSHOT_INTERVAL_MS = 10_000;
/** 관측 요청 하트비트 간격. 서버 TTL(90초)보다 짧게 둔다. */
const HEARTBEAT_INTERVAL_MS = 60_000;
/** 경로 보기 간격. */
const ROUTE_VIEW_INTERVAL_MS = 15_000;
/** 마커 위치를 다시 계산하는 간격. */
const RENDER_TICK_MS = 1000;
/** 참조 데이터(노선 선, 정류장)는 하루 단위로 바뀐다. */
const MAP_REF_STALE_MS = 10 * 60 * 1000;
const MS_PER_SECOND = 1000;
const SEOUL_BUS_PREFIX = "seoul-bus:";

const mapRefCache = createMapRefCache(Storage);

export interface RenderVehicle {
	bearing: number;
	id: string;
	kind: "bus" | "subway";
	lastSeenAt: number;
	latitude: number;
	legIndex: number;
	longitude: number;
	observedAt: number;
}

export interface MapLeg {
	leg: Leg;
	shape: [number, number][];
	showVehicles: boolean;
	vehicles: RenderVehicle[];
}

export interface MapData {
	allHidden: boolean;
	legs: MapLeg[];
	route: Route | null;
	source: "session" | "route-view";
	view: RouteView | null;
}

type LegTrack =
	| { kind: "bus"; map: BusMap; track: BusTrack }
	| { kind: "subway"; map: SubwayMap; track: SubwayTrack };

interface Snapshots {
	bus: BusSnapshot | null;
	subway: SubwaySnapshot | null;
}

type RefMap = BusMap | SubwayMap | null;

function refKey(leg: Leg): string {
	return `${leg.mode}:${leg.line}`;
}

/** 서버에서 받고 캐시에 둔다. 받지 못하면 캐시를 쓴다. 둘 다 없으면 null. */
async function loadRefMap(leg: Leg): Promise<RefMap> {
	const key = refKey(leg);
	const bareLine = leg.line.slice(leg.line.indexOf(":") + 1);
	const result =
		leg.mode === "bus"
			? await fetchBusMap(serverClient, bareLine)
			: await fetchSubwayMap(serverClient, bareLine);
	if (result.ok) {
		await mapRefCache.set(key, String(result.value.batchId), result.value);
		return result.value;
	}
	const cached = await mapRefCache.get<BusMap | SubwayMap>(key);
	return cached?.value ?? null;
}

/** 구간 방향의 가지 중 승차역(가능하면 하차역도)을 지나는 것. */
function subwayBranch(leg: SubwayLeg, map: SubwayMap) {
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
	return track === null ? null : { kind: "subway", map: subwayMap, track };
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

/** 세션 응답의 경로 예상을 경로 보기와 같은 모양으로 바꾼다. 세션은 지금 구간(기본 경로) 또는 첫 구간(대안)만 안다. */
function viewFromSession(
	route: Route,
	sessionRoute: SessionRouteView,
	currentLegIndex: number
): RouteView {
	const knownIndex = route.rank === 0 ? currentLegIndex : 0;
	return {
		destinationEtaAt:
			sessionRoute.destinationEtaEpoch === null
				? null
				: sessionRoute.destinationEtaEpoch * MS_PER_SECOND,
		legs: route.legs.map((_, index) => {
			const known = index === knownIndex;
			return {
				approaching: [],
				boardEtaAt:
					known && sessionRoute.boardEtaEpoch !== null
						? sessionRoute.boardEtaEpoch * MS_PER_SECOND
						: null,
				etaState: known ? sessionRoute.etaState : "estimated",
				method: null,
				positionState: known ? sessionRoute.positionState : "none",
				vehicleId: sessionRoute.legVehicleIds[index] ?? null,
			};
		}),
	};
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
	boardedVehicleId: string | null
): (BusSnapshotVehicle | SubwaySnapshotVehicle)[] {
	if (leg.mode === "bus" && legTrack.kind === "bus") {
		return busVehiclesForLeg(
			leg as BusLeg,
			snapshots.bus?.vehicles ?? [],
			boardedVehicleId,
			legTrack.map
		);
	}
	if (leg.mode === "subway" && legTrack.kind === "subway") {
		return subwayVehiclesForLeg(
			leg as SubwayLeg,
			snapshots.subway?.vehicles ?? [],
			legTrack.map,
			boardedVehicleId
		);
	}
	return [];
}

function trackShape(legTrack: LegTrack | null): [number, number][] {
	return legTrack === null ? [] : [...legTrack.track.shape];
}

/** 보일 때만 폴링하는 하트비트·스냅샷·경로 보기를 묶는다. 위치는 서버에 보내지 않고 노선 ref만 보낸다. */
function useVisiblePoll(
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
			return viewFromSession(route, sessionRoute, session.content.legIndex);
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
			const boarded = sessionRoute?.legVehicleIds[legIndex] ?? null;
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
	}, [snapshots, legTracks, legsWithFlags, sessionRoute]);

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
			legsWithFlags.map(({ leg, showVehicles }, legIndex) => {
				const legTrack = legTracks[legIndex] ?? null;
				const vehicles: RenderVehicle[] = [];
				if (showVehicles && legTrack !== null) {
					const boarded = sessionRoute?.legVehicleIds[legIndex] ?? null;
					for (const vehicle of legVehicles(
						leg,
						legTrack,
						snapshots,
						boarded
					)) {
						const id = vehicleIdOf(vehicle);
						const state = motion.current.get(`${legIndex}:${id}`);
						const at =
							state === undefined
								? null
								: pointAlong(legTrack.track.shape, positionAt(state, nowMs));
						if (at !== null) {
							vehicles.push({
								bearing: at.bearing,
								id,
								kind: legTrack.kind,
								lastSeenAt: vehicle.lastSeenAt,
								latitude: at.latitude,
								legIndex,
								longitude: at.longitude,
								observedAt: vehicle.observedAt,
							});
						}
					}
				}
				return { leg, shape: trackShape(legTrack), showVehicles, vehicles };
			}),
		[legsWithFlags, legTracks, snapshots, sessionRoute, nowMs, motionVersion]
	);

	return { allHidden, legs, route, source, view };
}

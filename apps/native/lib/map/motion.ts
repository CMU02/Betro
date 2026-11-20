import type {
	BusMap,
	BusSnapshotVehicle,
	SubwayMap,
	SubwaySnapshotVehicle,
} from "./map-client";

/**
 * 차량을 노선 선을 따라 앞으로만 움직인다(지도 설계 4.4).
 * - 관측 하나를 노선 위 거리(`TrackPoint`)로 바꾸고, 관측 사이를 속도로 보간한다.
 * - 외삽은 아직 도착이 관측되지 않은 다음 정류장(역)을 넘지 않는다.
 * - 새 관측을 받은 순간 표시 위치가 뒤로 가거나 정류장 한 구간 이상 앞으로 뛰면 7.2 위반이다.
 */

type LngLat = readonly [number, number];
type Shape = readonly LngLat[];

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const FULL_TURN_DEG = 360;
const MS_PER_SEC = 1000;
/** 버스 속도 추정의 상한(m/s, 약 90km/h). GPS가 튄 두 관측으로 터무니없는 속도를 내지 않게 한다. */
const MAX_ESTIMATED_SPEED_MPS = 25;
/**
 * 관측이 표시 위치보다 이만큼 넘게 뒤면 새 운행(같은 차량 번호로 처음부터 다시 도는 버스)이나
 * 2호선 순환 이음매로 보고 그 자리에서 다시 시작한다. 외삽이 앞서간 거리는 한 구간을 넘지 않으므로
 * 그보다 넉넉히 크게 둔다.
 */
const REANCHOR_BEHIND_M = 5000;
/** 정류장(역) 좌표를 선에 투영할 때, 이 거리 안에 처음 닿는 곳을 그 정류장 자리로 본다. */
const STOP_SNAP_M = 80;
/** 두 상한(다음 정류장 거리)이 이만큼 안이면 같은 정류장으로 본다. */
const SAME_STOP_EPSILON_M = 1;

export interface TrackPoint {
	/** 노선 선 시작에서 잰 관측 위치(미터). */
	distanceM: number;
	/** 지금 정류장 구간의 길이. 순간이동(jump) 판단 기준이다. 모르면 null. */
	intervalM: number | null;
	/** 아직 도착이 관측되지 않은 다음 정류장(역)의 거리. 종점 뒤면 null. */
	nextStopDistanceM: number | null;
	observedAt: number;
	/** 시간표로 아는 이 구간의 속도(m/s). 지하철은 `nextRunSec`로 낸다. 정차 중이면 0, 모르면 null. */
	scheduledSpeedMps: number | null;
}

export interface MotionState {
	/** `shownDistanceM`을 정한 시각. 보간의 경과 시간은 여기서 잰다. */
	anchorAt: number;
	ceilingM: number | null;
	lastObservedAt: number;
	/** 마지막 관측의 노선 위 거리. 다음 관측과 함께 속도를 낸다. */
	observedDistanceM: number;
	/** `anchorAt` 시점의 표시 위치. */
	shownDistanceM: number;
	speedMps: number;
}

export type MotionViolation = "backward" | "jump";

/** 표시 위치. 앵커에서 속도로 나아가되 상한(다음 정류장)을 넘지 않고, 절대 줄지 않는다. */
export function positionAt(state: MotionState, nowMs: number): number {
	const elapsedSec = Math.max(0, nowMs - state.anchorAt) / MS_PER_SEC;
	const extrapolated = state.shownDistanceM + state.speedMps * elapsedSec;
	return Math.max(
		state.shownDistanceM,
		Math.min(extrapolated, state.ceilingM ?? Number.POSITIVE_INFINITY)
	);
}

function startAt(
	point: TrackPoint,
	speedMps: number,
	atMs: number
): MotionState {
	const fresh: MotionState = {
		anchorAt: point.observedAt,
		ceilingM: point.nextStopDistanceM,
		lastObservedAt: point.observedAt,
		observedDistanceM: point.distanceM,
		shownDistanceM: point.distanceM,
		speedMps,
	};
	// 늦게 받은 관측은 받은 시각까지 같은 규칙으로 나아간 자리에서 시작한다.
	return { ...fresh, anchorAt: atMs, shownDistanceM: positionAt(fresh, atMs) };
}

function speedFor(state: MotionState | null, point: TrackPoint): number {
	if (point.scheduledSpeedMps !== null) {
		return Math.max(0, point.scheduledSpeedMps);
	}
	if (state === null) {
		return 0;
	}
	const dtSec = (point.observedAt - state.lastObservedAt) / MS_PER_SEC;
	if (dtSec <= 0) {
		return 0;
	}
	const estimate = (point.distanceM - state.observedDistanceM) / dtSec;
	return Math.min(Math.max(0, estimate), MAX_ESTIMATED_SPEED_MPS);
}

/**
 * 새 관측을 반영한다. `nowMs`는 관측을 받은 시각이고, 위반은 그 순간 표시 위치가 바뀐 결과로 판단한다.
 * - 같거나 더 오래된 관측(수집기가 못 본 차량을 남겨 둔 것)은 갱신이 아니다. 같은 `state`를 그대로 돌려준다.
 *   호출부는 `state`가 바뀐 경우만 지표에 센다.
 * - 뒤에 있는 관측이면 표시 위치를 두고 멈춘다. 표시는 그대로라 위반이 아니다.
 * - 정류장 한 구간 이상 앞으로 뛰면 `jump`. 표시 위치는 앞으로만 가므로 `backward`는 이 함수에서 나오지 않는다.
 */
export function observe(
	state: MotionState | null,
	point: TrackPoint,
	nowMs: number = point.observedAt
): { state: MotionState; violation: MotionViolation | null } {
	if (state !== null && point.observedAt <= state.lastObservedAt) {
		return { state, violation: null };
	}
	const atMs = Math.max(nowMs, point.observedAt, state?.anchorAt ?? 0);
	const next = startAt(point, speedFor(state, point), atMs);
	if (state === null) {
		return { state: next, violation: null };
	}
	const before = positionAt(state, atMs);
	if (before - next.shownDistanceM > REANCHOR_BEHIND_M) {
		return { state: next, violation: null };
	}
	if (next.shownDistanceM < before) {
		// 시간표 속도가 있는 관측(지하철 역 단위 위치)은 같은 구간에서 하한일 뿐이라 진행을 이어 간다.
		// 그 밖에는 표시를 두고 멈춰서 다음 관측을 기다린다.
		const sameScheduledInterval =
			point.scheduledSpeedMps !== null &&
			point.nextStopDistanceM !== null &&
			state.ceilingM !== null &&
			Math.abs(point.nextStopDistanceM - state.ceilingM) < SAME_STOP_EPSILON_M;
		return {
			state: {
				anchorAt: atMs,
				ceilingM: state.ceilingM,
				lastObservedAt: point.observedAt,
				observedDistanceM: point.distanceM,
				shownDistanceM: before,
				speedMps: sameScheduledInterval ? next.speedMps : 0,
			},
			violation: null,
		};
	}
	const jumped =
		point.intervalM !== null &&
		point.intervalM > 0 &&
		next.shownDistanceM - before >= point.intervalM;
	return { state: next, violation: jumped ? "jump" : null };
}

interface Geometry {
	/** 각 꼭짓점까지 선을 따라 잰 거리. */
	cum: number[];
	points: Shape;
}

const geometryCache = new WeakMap<Shape, Geometry>();

/** 짧은 구간이라 구간 가운데 위도로 펼친 평면 거리로 잰다(서울 범위에서 대권 거리와 거의 같다). */
function planarDelta(
	from: LngLat,
	to: LngLat
): { dx: number; dy: number; kx: number; ky: number } {
	const midLat = ((from[1] + to[1]) / 2) * DEG_TO_RAD;
	const kx = EARTH_RADIUS_M * Math.cos(midLat) * DEG_TO_RAD;
	const ky = EARTH_RADIUS_M * DEG_TO_RAD;
	return {
		dx: (to[0] - from[0]) * kx,
		dy: (to[1] - from[1]) * ky,
		kx,
		ky,
	};
}

function geometryOf(shape: Shape): Geometry {
	const cached = geometryCache.get(shape);
	if (cached) {
		return cached;
	}
	const cum = [0];
	for (let i = 1; i < shape.length; i += 1) {
		const from = shape[i - 1];
		const to = shape[i];
		let length = 0;
		if (from && to) {
			const { dx, dy } = planarDelta(from, to);
			length = Math.hypot(dx, dy);
		}
		cum.push((cum[i - 1] ?? 0) + length);
	}
	const geometry = { cum, points: shape };
	geometryCache.set(shape, geometry);
	return geometry;
}

function totalLength(geometry: Geometry): number {
	return geometry.cum.at(-1) ?? 0;
}

/** 선분 i 위에서 점에 가장 가까운 자리. `[fromM, toM]` 밖으로는 나가지 않는다. */
function nearestOnSegment(
	geometry: Geometry,
	i: number,
	target: LngLat,
	fromM: number,
	toM: number
): { distanceM: number; offsetM: number } | null {
	const a = geometry.points[i];
	const b = geometry.points[i + 1];
	const startM = geometry.cum[i] ?? 0;
	const length = (geometry.cum[i + 1] ?? startM) - startM;
	if (!(a && b) || length <= 0) {
		return null;
	}
	const { dx, dy, kx, ky } = planarDelta(a, b);
	const px = (target[0] - a[0]) * kx;
	const py = (target[1] - a[1]) * ky;
	const raw = (px * dx + py * dy) / (length * length);
	const tMin = Math.max(0, (fromM - startM) / length);
	const tMax = Math.min(1, (toM - startM) / length);
	if (tMin > tMax) {
		return null;
	}
	const t = Math.min(Math.max(raw, tMin), tMax);
	return {
		distanceM: startM + t * length,
		offsetM: Math.hypot(px - t * dx, py - t * dy),
	};
}

/** `distanceM` 자리를 품은 첫 선분 번호(이진 탐색). */
function segmentAt(geometry: Geometry, distanceM: number): number {
	let lo = 0;
	let hi = Math.max(0, geometry.points.length - 2);
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		if ((geometry.cum[mid + 1] ?? 0) < distanceM) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

/** `[fromM, toM]` 안에서 점에 가장 가까운 선 위 거리. */
function nearestInRange(
	geometry: Geometry,
	target: LngLat,
	fromM: number,
	toM: number
): number {
	let best: { distanceM: number; offsetM: number } | null = null;
	for (
		let i = segmentAt(geometry, fromM);
		i < geometry.points.length - 1;
		i += 1
	) {
		if ((geometry.cum[i] ?? 0) > toM) {
			break;
		}
		const found = nearestOnSegment(geometry, i, target, fromM, toM);
		if (found && (best === null || found.offsetM < best.offsetM)) {
			best = found;
		}
	}
	return best?.distanceM ?? fromM;
}

/**
 * `fromM`부터 앞으로 가며 점이 처음 가까워지는 곳(STOP_SNAP_M 안의 첫 극소)을 고른다.
 * 왕복 노선이나 순환선에서 가장 가까운 곳을 고르면 오는 길에 붙을 수 있어서다.
 * 그런 곳이 없으면 남은 선 전체에서 가장 가까운 곳이다.
 */
function projectForward(
	geometry: Geometry,
	target: LngLat,
	fromM: number
): number {
	const endM = totalLength(geometry);
	let best: { distanceM: number; offsetM: number } | null = null;
	let snapped = false;
	for (
		let i = segmentAt(geometry, fromM);
		i < geometry.points.length - 1;
		i += 1
	) {
		const found = nearestOnSegment(geometry, i, target, fromM, endM);
		if (!found) {
			continue;
		}
		if (snapped && best && found.offsetM > best.offsetM) {
			break;
		}
		if (best === null || found.offsetM < best.offsetM) {
			best = found;
		}
		if (best.offsetM <= STOP_SNAP_M) {
			snapped = true;
		}
	}
	return best?.distanceM ?? fromM;
}

/** 정류장(역) 좌표를 순서대로 선에 투영한 거리. 앞 정류장보다 뒤로 가지 않는다. */
function projectStops(geometry: Geometry, stops: readonly LngLat[]): number[] {
	const distances: number[] = [];
	let previous = 0;
	for (const stop of stops) {
		previous = projectForward(geometry, stop, previous);
		distances.push(previous);
	}
	return distances;
}

export interface BusTrack {
	shape: BusMap["shape"];
	/** 정류장 순번(`seq`) → 노선 위 거리. */
	stopDistanceBySeq: ReadonlyMap<number, number>;
	/** 순번 오름차순. */
	stopSeqs: readonly number[];
}

/** 버스 노선 선 위에 정류장 거리를 깐다. 선이 없으면 null. */
export function createBusTrack(map: BusMap): BusTrack | null {
	if (map.shape.length < 2) {
		return null;
	}
	const stops = [...map.stops].sort((a, b) => a.seq - b.seq);
	const distances = projectStops(
		geometryOf(map.shape),
		stops.map((stop) => [stop.lng, stop.lat] as const)
	);
	return {
		shape: map.shape,
		stopDistanceBySeq: new Map(
			stops.map((stop, index) => [stop.seq, distances[index] ?? 0])
		),
		stopSeqs: stops.map((stop) => stop.seq),
	};
}

/**
 * 버스 관측 → 노선 위 거리. `sectOrd`는 차량이 지나온 정류장 순번이라 그 다음 정류장까지의 구간 안에 투영한다.
 * 그 순번을 모르면 null.
 */
export function busTrackPoint(
	track: BusTrack,
	vehicle: BusSnapshotVehicle
): TrackPoint | null {
	const fromM = track.stopDistanceBySeq.get(vehicle.sectOrd);
	if (fromM === undefined) {
		return null;
	}
	const index = track.stopSeqs.indexOf(vehicle.sectOrd);
	const nextSeq = track.stopSeqs[index + 1];
	const toM =
		nextSeq === undefined ? undefined : track.stopDistanceBySeq.get(nextSeq);
	const geometry = geometryOf(track.shape);
	const distanceM = nearestInRange(
		geometry,
		[vehicle.lng, vehicle.lat],
		fromM,
		toM ?? totalLength(geometry)
	);
	return {
		distanceM,
		intervalM: toM === undefined ? null : toM - fromM,
		nextStopDistanceM: toM ?? null,
		observedAt: vehicle.observedAt,
		scheduledSpeedMps: null,
	};
}

type SubwayBranch = SubwayMap["branches"][number];

export interface SubwayTrack {
	shape: SubwayBranch["shape"];
	/** 역 순서대로. `distanceM`은 역 좌표를 선에 투영한 거리다. */
	stations: readonly {
		distanceM: number;
		nextRunSec: number | null;
		stop: string;
	}[];
}

/**
 * 지하철 한 가지(방향별 선로)의 역 거리. 서버 `offsetM`은 역 좌표에서 선로까지의 수직 거리라 쓰지 않고,
 * 역 좌표를 선에 직접 투영한다. 선이 없으면 null.
 */
export function createSubwayTrack(branch: SubwayBranch): SubwayTrack | null {
	if (branch.shape.length < 2) {
		return null;
	}
	const stations = [...branch.stations].sort((a, b) => a.seq - b.seq);
	const distances = projectStops(
		geometryOf(branch.shape),
		stations.map((station) => [station.lng, station.lat] as const)
	);
	return {
		shape: branch.shape,
		stations: stations.map((station, index) => ({
			distanceM: distances[index] ?? 0,
			nextRunSec: station.nextRunSec,
			stop: station.stop,
		})),
	};
}

/** 역 i에서 다음 역까지를 시간표 소요시간으로 가는 속도. 모르면 null. */
function runSpeed(track: SubwayTrack, i: number): number | null {
	const from = track.stations[i];
	const to = track.stations[i + 1];
	if (!(from && to) || from.nextRunSec === null || from.nextRunSec <= 0) {
		return null;
	}
	return (to.distanceM - from.distanceM) / from.nextRunSec;
}

function segmentPoint(
	track: SubwayTrack,
	vehicle: SubwaySnapshotVehicle,
	i: number,
	at: "start" | "end",
	scheduledSpeedMps: number | null
): TrackPoint {
	const from = track.stations[i];
	const to = track.stations[i + 1];
	const startM = from?.distanceM ?? 0;
	const endM = to?.distanceM ?? null;
	return {
		distanceM: at === "start" ? startM : (endM ?? startM),
		intervalM: endM === null ? null : endM - startM,
		nextStopDistanceM: endM,
		observedAt: vehicle.observedAt,
		scheduledSpeedMps,
	};
}

/**
 * 지하철 관측 → 노선 위 거리. `dev` 위치는 역 단위라 상태로 구간을 정한다.
 * - 전역 출발(`prev-depart`): 앞 역을 막 떠났다. 앞 역~이 역을 시간표 속도로 간다.
 * - 진입(`approach`): 이 역에 거의 다 왔다. 이 역 자리에 두고 도착이 관측될 때까지 넘지 않는다.
 * - 도착(`arrive`): 이 역에 서 있다. 출발이 관측될 때까지 움직이지 않는다.
 * - 출발(`depart`)이나 모름: 이 역~다음 역을 시간표 속도로 간다.
 * 역을 모르면 null.
 */
export function subwayTrackPoint(
	track: SubwayTrack,
	vehicle: SubwaySnapshotVehicle
): TrackPoint | null {
	if (vehicle.statnId === null) {
		return null;
	}
	const stop = `seoul-subway:${vehicle.statnId}`;
	const i = track.stations.findIndex((station) => station.stop === stop);
	if (i === -1) {
		return null;
	}
	switch (vehicle.status) {
		case "prev-depart":
			return i === 0
				? segmentPoint(track, vehicle, i, "start", 0)
				: segmentPoint(track, vehicle, i - 1, "start", runSpeed(track, i - 1));
		case "approach": {
			const here = segmentPoint(track, vehicle, Math.max(0, i - 1), "end", 0);
			const stationM = track.stations[i]?.distanceM ?? here.distanceM;
			return { ...here, distanceM: stationM, nextStopDistanceM: stationM };
		}
		case "arrive":
			return segmentPoint(track, vehicle, i, "start", 0);
		default:
			return segmentPoint(track, vehicle, i, "start", runSpeed(track, i));
	}
}

/** 노선 선 위 거리의 좌표와 진행 방향(북쪽 기준 시계방향 도). 선이 비면 null, 양 끝은 끝점에 붙인다. */
export function pointAlong(
	shape: readonly [number, number][],
	distanceM: number
): { bearing: number; latitude: number; longitude: number } | null {
	const [only] = shape;
	if (only === undefined) {
		return null;
	}
	const geometry = geometryOf(shape);
	const clamped = Math.min(Math.max(distanceM, 0), totalLength(geometry));
	let i = segmentAt(geometry, clamped);
	// 길이 0인 선분은 방향이 없으니 앞의 길이 있는 선분으로 넘긴다.
	while (
		i < shape.length - 2 &&
		(geometry.cum[i + 1] ?? 0) - (geometry.cum[i] ?? 0) <= 0
	) {
		i += 1;
	}
	const a = shape[i] ?? only;
	const b = shape[i + 1] ?? a;
	const startM = geometry.cum[i] ?? 0;
	const length = (geometry.cum[i + 1] ?? startM) - startM;
	const t =
		length > 0 ? Math.min(Math.max((clamped - startM) / length, 0), 1) : 0;
	const { dx, dy } = planarDelta(a, b);
	const bearing =
		length > 0
			? (Math.atan2(dx, dy) * RAD_TO_DEG + FULL_TURN_DEG) % FULL_TURN_DEG
			: 0;
	return {
		bearing,
		latitude: a[1] + (b[1] - a[1]) * t,
		longitude: a[0] + (b[0] - a[0]) * t,
	};
}

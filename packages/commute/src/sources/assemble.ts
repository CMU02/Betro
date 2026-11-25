import type { CommuteConfig } from "../config";
import type { BusLeg, Leg, SubwayLeg } from "../plan";
import { type LineRef, parseRef } from "../refs";
import { type BusSchedule, scheduledHeadwayMs } from "./bus-schedule";
import {
	type BusBoards,
	busBoards,
	type RouteStopArrival,
	SOURCE_TIMEZONE as SEOUL_BUS_TIMEZONE,
} from "./seoul-bus";
import {
	fillFromTimetable,
	type StationRow,
	stationBoard,
} from "./seoul-subway";
import type { Progress, StopBoard, TransitBoards } from "./types";

/**
 * 실행기가 한 tick에 모은 출처별 원자료. `bus`의 키는 `busRouteId`, `subway`의 키는 `statnId`,
 * `timetable`의 키는 `legKey(leg)`다. `timetable.arrivals`는 그 구간의 승차역 시간표 도착이다.
 */
export interface RawBoards {
	bus: Record<
		string,
		{
			fetchedAt: number;
			now: RouteStopArrival[];
			prev: RouteStopArrival[] | null;
		}
	>;
	/** 버스 노선의 정적 배차간격·첫차·막차. 키는 전체 노선 ID(`leg.line`). 읽지 못했으면 없다. */
	busSchedules?: Record<LineRef, BusSchedule>;
	subway: Record<
		string,
		{ fetchedAt: number; prev: StationRow[] | null; rows: StationRow[] }
	>;
	timetable: {
		arrivals: Record<string, { at: number; tripId: number }[]>;
		rideMs: Record<string, number | null>;
	};
}

/** 구간을 가리키는 키. 같은 노선이라도 정류장·순번·방향이 다르면 다르다. */
export function legKey(leg: Leg): string {
	if (leg.mode === "bus") {
		return `${leg.line}|${leg.board.seq}:${leg.board.stop}|${leg.alight.seq}:${leg.alight.stop}`;
	}
	return `${leg.line}|${leg.direction}|${leg.board.stop}|${leg.alight.stop}`;
}

/**
 * 구간의 도착판을 내는 방법. `scheduled-bus`는 실시간 연결이 없는 버스(GBIS·TAGO)라 도착판과
 * 진행이 없고 정적 배차간격만 쓴다. 5-B에서 실시간 어댑터가 이 자리에 들어간다.
 */
type Adapter =
	| { kind: "seoul-bus"; leg: BusLeg }
	| { kind: "scheduled-bus"; leg: BusLeg }
	| { kind: "seoul-subway"; leg: SubwayLeg };

/** 노선 출처로 어댑터를 고른다. 출처와 수단이 맞지 않으면 null. */
function adapterOf(leg: Leg): Adapter | null {
	const { source } = parseRef(leg.line);
	if (leg.mode === "bus") {
		if (source === "seoul-bus") {
			return { kind: source, leg };
		}
		if (source === "gbis" || source === "tago") {
			return { kind: "scheduled-bus", leg };
		}
		return null;
	}
	return source === "seoul-subway" ? { kind: source, leg } : null;
}

/**
 * 원자료 → 세션이 보는 도착판. 구간의 노선 출처로 갈라 버스는 `busBoards`, 지하철은
 * `stationBoard` + `fillFromTimetable`을 쓴다. 출처 이름은 `sources/` 밖으로 나가지 않는다.
 */
export function assembleBoards(
	raw: RawBoards,
	config: CommuteConfig
): TransitBoards {
	const busCache = new Map<string, BusBoards | null>();

	const busFor = (leg: BusLeg): BusBoards | null => {
		const routeId = parseRef(leg.line).id;
		const cached = busCache.get(routeId);
		if (cached !== undefined) {
			return cached;
		}
		const entry = raw.bus[routeId];
		const boards = entry
			? busBoards(entry.prev, entry.now, entry.fetchedAt)
			: null;
		busCache.set(routeId, boards);
		return boards;
	};

	const stationFor = (
		leg: SubwayLeg,
		at: "board" | "alight"
	): StopBoard | null => {
		const statnId = parseRef(leg[at].stop).id;
		const entry = raw.subway[statnId];
		if (!entry) {
			return null;
		}
		const biasSec = config.subwayEtaBiasSec[parseRef(leg.line).id] ?? 0;
		const board = stationBoard(
			entry.prev,
			entry.rows,
			leg.direction,
			biasSec,
			entry.fetchedAt
		);
		// 시간표 도착은 승차역의 것이라 승차역 도착판에만 붙인다.
		if (at === "alight") {
			return board;
		}
		return fillFromTimetable(board, raw.timetable.arrivals[legKey(leg)] ?? []);
	};

	const board = (leg: Leg, at: "board" | "alight"): StopBoard | null => {
		const adapter = adapterOf(leg);
		if (adapter?.kind === "seoul-bus") {
			return busFor(adapter.leg)?.board(adapter.leg[at].seq) ?? null;
		}
		return adapter?.kind === "seoul-subway"
			? stationFor(adapter.leg, at)
			: null;
	};

	const progress = (leg: Leg, vehicleId: string): Progress | null => {
		const adapter = adapterOf(leg);
		if (adapter?.kind === "seoul-bus") {
			return (
				busFor(adapter.leg)?.progress(vehicleId, adapter.leg.alight.seq) ?? null
			);
		}
		const train = (
			adapter?.kind === "seoul-subway"
				? stationFor(adapter.leg, "alight")
				: null
		)?.approaching.find((entry) => entry.vehicleId === vehicleId);
		if (!train) {
			return null;
		}
		return {
			etaAt: train.etaAt,
			method: train.method,
			stopsAway: train.stopsAway,
		};
	};

	const rideMs = (leg: Leg, vehicleId: string | null): number | null => {
		const adapter = adapterOf(leg);
		if (adapter?.kind === "seoul-bus") {
			const { alight, board: boarding } = adapter.leg;
			return (
				busFor(adapter.leg)?.rideMs(vehicleId, boarding.seq, alight.seq) ?? null
			);
		}
		return adapter?.kind === "seoul-subway"
			? (raw.timetable.rideMs[legKey(adapter.leg)] ?? null)
			: null;
	};

	// 첫차·막차는 출처의 현지 시각이라 세션마다가 아니라 출처 시간대로 본다.
	// 경기·인천도 서울과 같은 시간대다. GBIS와 서울은 노선 ID가 겹칠 수 있어 전체 노선 ID로 찾는다.
	const scheduled = (leg: Leg, atEpochMs: number): number | null => {
		const adapter = adapterOf(leg);
		if (adapter === null || adapter.kind === "seoul-subway") {
			return null;
		}
		const schedule = raw.busSchedules?.[adapter.leg.line];
		return schedule
			? scheduledHeadwayMs(schedule, atEpochMs, SEOUL_BUS_TIMEZONE)
			: null;
	};

	return { board, progress, rideMs, scheduledHeadwayMs: scheduled };
}

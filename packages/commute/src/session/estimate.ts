import type { CommuteConfig } from "../config";
import type { Leg, Route } from "../plan";
import type {
	Approaching,
	ArrivalMethod,
	StopBoard,
	TransitBoards,
} from "../sources/types";

const MINUTE_MS = 60_000;

/** 시각을 실시간 관측이 아니라 추정으로 낸 방법. */
const ESTIMATED_METHODS: ReadonlySet<ArrivalMethod> = new Set<ArrivalMethod>([
	"timetable",
	"headway",
	"extrapolated",
]);

/** 경로 한 구간의 탈 차량과 도착 예상. */
export interface LegEstimate {
	alightEtaAt: number | null;
	boardEtaAt: number | null;
	/** 시각의 확신. 위치와 따로 본다(4.3). */
	etaState: "live" | "estimated";
	method: ArrivalMethod | null;
	/** 위치의 확신. 도착판이 묵었으면 stale, 아예 없으면 none. */
	positionState: "live" | "stale" | "none";
	/** 탑승 전에는 승차 정류장까지, 탄 차량이 승차 정류장을 지난 뒤에는 하차 정류장까지 남은 정거장. */
	stopsAway: number | null;
	vehicleId: string | null;
}

/** 경로 하나의 목적지 도착 예상. */
export interface RouteEstimate {
	destinationEtaAt: number | null;
	legs: LegEstimate[];
	rank: number;
}

interface EstimateInput {
	/** 구간마다 이미 잡았거나 탄 차량. 있으면 다시 고르지 않는다. */
	fixed: (string | null)[];
	/**
	 * 지금 구간(세션의 legIndex). 기본 0. 앞 구간은 끝난 것으로 보고 새 차량을 고르지 않으며,
	 * 그 하차 시각을 다음 구간으로 잇지 않는다.
	 */
	fromLeg?: number;
	now: number;
	/** fromLeg 구간의 승차 정류장에 있을 수 있는 시각. */
	readyAt: number;
	skip: ReadonlySet<string>;
}

/** 승차 정류장에서 고른 결과. alightEtaAt은 진행 정보에서 바로 얻었을 때만 있다. */
interface Pick {
	alightEtaAt?: number | null;
	boardEtaAt: number | null;
	method: ArrivalMethod | null;
	stopsAway: number | null;
	vehicleId: string | null;
}

/**
 * readyAt 이후에 오는 첫 차량. readyAt과 같은 시각에 오는 차량은 탈 수 있다고 본다.
 * skip에 든 차량과 도착 시각을 모르는 차량은 고르지 않는다.
 */
export function selectVehicle(
	board: StopBoard,
	readyAt: number,
	skip: ReadonlySet<string>
): Approaching | null {
	for (const vehicle of board.approaching) {
		if (skip.has(vehicle.vehicleId) || vehicle.etaAt === null) {
			continue;
		}
		if (vehicle.etaAt >= readyAt) {
			return vehicle;
		}
	}
	return null;
}

function knownHeadway(board: StopBoard): number | null {
	return board.headwayMs !== null && board.headwayMs > 0
		? board.headwayMs
		: null;
}

/** 위치를 모를 때: 정류장에 선 뒤 평균 배차간격의 반을 기다린다고 본다. */
function halfHeadwayAfter(
	readyAt: number | null,
	headwayMs: number | null
): number | null {
	if (readyAt === null || headwayMs === null) {
		return null;
	}
	return readyAt + headwayMs / 2;
}

/**
 * 도착판이 보여 주는 차량이 모두 readyAt 전이면, 마지막 차량 뒤로 배차간격을 쌓아
 * readyAt 이후의 첫 차량 시각을 낸다(대개 한 번).
 */
function beyondBoard(
	board: StopBoard,
	readyAt: number,
	headwayMs: number | null
): number | null {
	if (headwayMs === null) {
		return null;
	}
	let lastEtaAt: number | null = null;
	for (const vehicle of board.approaching) {
		if (
			vehicle.etaAt !== null &&
			(lastEtaAt === null || vehicle.etaAt > lastEtaAt)
		) {
			lastEtaAt = vehicle.etaAt;
		}
	}
	if (lastEtaAt === null) {
		return halfHeadwayAfter(readyAt, headwayMs);
	}
	const steps = Math.max(1, Math.ceil((readyAt - lastEtaAt) / headwayMs));
	return lastEtaAt + steps * headwayMs;
}

function pickFixed(
	leg: Leg,
	board: StopBoard,
	vehicleId: string,
	boards: TransitBoards
): Pick {
	const onBoard = board.approaching.find(
		(vehicle) => vehicle.vehicleId === vehicleId
	);
	if (onBoard) {
		return {
			boardEtaAt: onBoard.etaAt,
			method: onBoard.method,
			stopsAway: onBoard.stopsAway,
			vehicleId,
		};
	}
	// 승차 정류장 목록에 없으면 이미 지나갔을 수 있다(탄 차량). 하차 쪽 진행을 본다.
	const progress = boards.progress(leg, vehicleId);
	if (progress) {
		return {
			alightEtaAt: progress.etaAt,
			boardEtaAt: null,
			method: progress.method,
			stopsAway: progress.stopsAway,
			vehicleId,
		};
	}
	return { boardEtaAt: null, method: null, stopsAway: null, vehicleId };
}

function pickFree(
	board: StopBoard,
	readyAt: number | null,
	skip: ReadonlySet<string>
): Pick {
	if (readyAt === null) {
		return { boardEtaAt: null, method: null, stopsAway: null, vehicleId: null };
	}
	const chosen = selectVehicle(board, readyAt, skip);
	if (chosen) {
		return {
			boardEtaAt: chosen.etaAt,
			method: chosen.method,
			stopsAway: chosen.stopsAway,
			vehicleId: chosen.vehicleId,
		};
	}
	return {
		boardEtaAt: beyondBoard(board, readyAt, knownHeadway(board)),
		method: "headway",
		stopsAway: null,
		vehicleId: null,
	};
}

function alightFrom(
	leg: Leg,
	pick: Pick,
	boards: TransitBoards
): number | null {
	if (pick.alightEtaAt !== undefined) {
		return pick.alightEtaAt;
	}
	if (pick.boardEtaAt === null) {
		return null;
	}
	const rideMs = boards.rideMs(leg, pick.vehicleId);
	return rideMs === null ? null : pick.boardEtaAt + rideMs;
}

/** 새 도착판에서의 시각 상태. 묵었거나 없는 도착판은 언제나 estimated다. */
function etaStateOf(method: ArrivalMethod | null): LegEstimate["etaState"] {
	return method !== null && ESTIMATED_METHODS.has(method)
		? "estimated"
		: "live";
}

function estimateLeg(
	leg: Leg,
	readyAt: number | null,
	fixedId: string | null,
	input: EstimateInput,
	boards: TransitBoards,
	config: CommuteConfig
): LegEstimate {
	const board = boards.board(leg, "board");
	const isStale =
		board !== null && input.now - board.sourceAt > config.staleAfterMs;
	if (board === null || isStale) {
		const positionState = board ? "stale" : "none";
		// 탄 차량(승차 도착판에 없음)은 하차 쪽 진행으로 하차 시각을 낸다. 위치는 여전히 묵은 것으로 둔다.
		const isOnBoard =
			board?.approaching.some((vehicle) => vehicle.vehicleId === fixedId) ??
			false;
		const progress =
			fixedId !== null && !isOnBoard ? boards.progress(leg, fixedId) : null;
		if (progress && progress.etaAt !== null) {
			return {
				alightEtaAt: progress.etaAt,
				boardEtaAt: null,
				etaState: "estimated",
				method: "headway",
				positionState,
				stopsAway: null,
				vehicleId: fixedId,
			};
		}
		const boardEtaAt = board
			? halfHeadwayAfter(readyAt, knownHeadway(board))
			: null;
		const pick: Pick = {
			boardEtaAt,
			method: "headway",
			stopsAway: null,
			vehicleId: fixedId,
		};
		return {
			alightEtaAt: alightFrom(leg, pick, boards),
			boardEtaAt,
			etaState: "estimated",
			method: "headway",
			positionState,
			stopsAway: null,
			vehicleId: fixedId,
		};
	}
	const pick =
		fixedId === null
			? pickFree(board, readyAt, input.skip)
			: pickFixed(leg, board, fixedId, boards);
	return {
		alightEtaAt: alightFrom(leg, pick, boards),
		boardEtaAt: pick.boardEtaAt,
		etaState: etaStateOf(pick.method),
		method: pick.method,
		positionState: "live",
		stopsAway: pick.stopsAway,
		vehicleId: pick.vehicleId,
	};
}

function plusMinutes(
	at: number | null,
	minutes: number | undefined
): number | null {
	return at === null ? null : at + (minutes ?? 0) * MINUTE_MS;
}

/**
 * 경로의 구간을 차례로 따라가며 탈 차량을 고르고 목적지 도착을 계산한다.
 * fromLeg 구간은 input.readyAt 뒤에 탈 수 있고, 그 뒤 구간 i는 앞 구간 하차 + 환승 도보 뒤에 탈 수 있다.
 * fromLeg 앞 구간은 끝났으므로 잡아 둔 차량만 보고(readyAt 없음) 하차 시각을 잇지 않는다.
 * 앞 구간 차량이 하차 정류장에 닿으면 진행 정보에 도착 시각이 없어지므로, 환승 중에도 다음 구간을 고르려면
 * 호출하는 쪽이 fromLeg와 그 구간의 readyAt을 직접 준다.
 */
export function estimateRoute(
	route: Route,
	boards: TransitBoards,
	input: EstimateInput,
	config: CommuteConfig
): RouteEstimate {
	const { fromLeg = 0, readyAt: currentReadyAt } = input;
	const legs: LegEstimate[] = [];
	let readyAt: number | null = null;
	for (const [index, leg] of route.legs.entries()) {
		if (index === fromLeg) {
			readyAt = currentReadyAt;
		} else if (index > fromLeg) {
			readyAt = plusMinutes(
				legs[index - 1]?.alightEtaAt ?? null,
				route.walkMinutes[index]
			);
		}
		legs.push(
			estimateLeg(
				leg,
				readyAt,
				input.fixed[index] ?? null,
				input,
				boards,
				config
			)
		);
	}
	const lastAlight = legs.at(-1)?.alightEtaAt ?? null;
	return {
		destinationEtaAt: plusMinutes(
			lastAlight,
			route.walkMinutes[route.legs.length]
		),
		legs,
		rank: route.rank,
	};
}

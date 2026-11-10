import type { CommuteConfig } from "../config";
import type { CommutePlan, Leg, Route } from "../plan";
import type { StopBoard, TransitBoards } from "../sources/types";
import type { RouteEstimate } from "./estimate";
import { estimateRoute } from "./estimate";

const MINUTE_MS = 60_000;
/** "탔어요"를 눌렀을 때 막 지난 차량으로 보는 범위. */
const BOARDED_LOOKBACK_MS = 3 * MINUTE_MS;
const NO_SKIP: ReadonlySet<string> = new Set();

/** 도보(집 → 승차) → 대기(정류장) → 탑승 → 도착(4.2). 끝나면 ended. */
export type Stage = "walk" | "wait" | "ride" | "arrived" | "ended";

export type EndReason =
	| "arrived"
	| "user"
	| "timeout"
	| "no-token"
	| "plan-removed";

/** 세션 하나의 상태. JSON으로 그대로 저장한다. */
export interface SessionState {
	/** 구간마다 탑승을 판단한 근거. 시각 추정이면 time, "탔어요"면 user. */
	boardedBy: ("time" | "user" | null)[];
	endReason: EndReason | null;
	/** 기본 경로가 먼저, 그 뒤 대안. 탑승 뒤에는 기본 경로만. */
	estimates: RouteEstimate[];
	/** 구간마다 잡았거나 탄 차량. */
	fixed: (string | null)[];
	initialDestinationEtaAt: number | null;
	leaveAt: number;
	legIndex: number;
	/** 이번 advance에서 잡은 차량이 지나가 다시 골랐으면 그 노선. 다음 advance에서 null로 돌아간다. */
	passed: { lineName: string } | null;
	planId: string;
	/**
	 * 지금 구간의 승차 정류장에 있을 수 있는 시각. 첫 advance에서 `max(now, leaveAt) + 첫 도보`로,
	 * 환승 구간은 앞 구간에서 내린 시각 + 환승 도보로 정하고 그 뒤로는 바꾸지 않는다.
	 * ride면 그 구간에서 탄 시각(지난 기록의 시각, 없으면 "탔어요"를 누른 시각)이고,
	 * arrived면 목적지에 닿는 시각(내린 시각 + 마지막 도보)이다. 시작 직후에는 null.
	 */
	readyAt: number | null;
	seq: number;
	sessionId: string;
	/** "다음 차 탈게요"를 눌렀거나 지나간 차량. 다시 고르지 않는다. */
	skip: string[];
	stage: Stage;
	startedAt: number;
}

export type SessionInput =
	| { kind: "boarded" }
	| { kind: "next" }
	| { kind: "end" };

function primaryRoute(plan: CommutePlan): Route | undefined {
	return plan.routes.find((route) => route.rank === 0);
}

function minutesMs(minutes: number | undefined): number {
	return (minutes ?? 0) * MINUTE_MS;
}

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
	const copy = [...list];
	copy[index] = value;
	return copy;
}

function isBeforeBoarding(state: SessionState): boolean {
	return state.stage === "walk" || state.stage === "wait";
}

function endWith(state: SessionState, reason: EndReason): SessionState {
	return { ...state, endReason: reason, passed: null, stage: "ended" };
}

export function startSession(
	plan: CommutePlan,
	due: { leaveAt: number; startAt: number },
	sessionId: string
): SessionState {
	const legCount = primaryRoute(plan)?.legs.length ?? 0;
	return {
		boardedBy: Array.from({ length: legCount }, () => null),
		endReason: null,
		estimates: [],
		fixed: Array.from({ length: legCount }, () => null),
		initialDestinationEtaAt: null,
		leaveAt: due.leaveAt,
		legIndex: 0,
		passed: null,
		planId: plan.planId,
		readyAt: null,
		seq: 0,
		sessionId,
		skip: [],
		stage: "walk",
		startedAt: due.startAt,
	};
}

interface Boarding {
	at: number;
	vehicleId: string | null;
}

/**
 * "탔어요": 잡아 둔 차량이 3분 안에 승차 정류장을 지났거나 정류장에 서 있으면 그 차량,
 * 아니면 3분 안에 지난 가장 최근 차량, 없으면 정류장에 선 차량, 없으면 잡아 둔 차량.
 * skip에 든 차량(건너뛰었거나 놓친 차량)은 고르지 않는다. 지난 차량이면 지난 시각에, 아니면 지금 탄 것으로 본다.
 */
function boardedVehicle(
	board: StopBoard | null,
	now: number,
	fixedId: string | null,
	skip: ReadonlySet<string>
): Boarding {
	const recentPassed = (board?.passed ?? []).filter(
		(entry) =>
			!skip.has(entry.vehicleId) &&
			entry.at <= now &&
			now - entry.at <= BOARDED_LOOKBACK_MS
	);
	const atStop = (board?.approaching ?? []).filter(
		(vehicle) => !skip.has(vehicle.vehicleId) && vehicle.stopsAway === 0
	);
	if (fixedId !== null) {
		const fixedPassed = recentPassed.find(
			(entry) => entry.vehicleId === fixedId
		);
		if (fixedPassed) {
			return { at: fixedPassed.at, vehicleId: fixedId };
		}
		if (atStop.some((vehicle) => vehicle.vehicleId === fixedId)) {
			return { at: now, vehicleId: fixedId };
		}
	}
	let recent: { at: number; vehicleId: string } | null = null;
	for (const entry of recentPassed) {
		if (recent === null || entry.at > recent.at) {
			recent = entry;
		}
	}
	if (recent) {
		return { at: recent.at, vehicleId: recent.vehicleId };
	}
	return { at: now, vehicleId: atStop[0]?.vehicleId ?? fixedId };
}

/** 탑승 전 단계의 사용자 입력(규칙 4, 5). */
function applyInput(
	state: SessionState,
	route: Route,
	boards: TransitBoards,
	now: number,
	input: SessionInput | undefined
): SessionState {
	const index = state.legIndex;
	const fixedId = state.fixed[index] ?? null;
	if (input?.kind === "next") {
		if (fixedId === null) {
			return state;
		}
		return {
			...state,
			fixed: replaceAt(state.fixed, index, null),
			skip: state.skip.includes(fixedId)
				? state.skip
				: [...state.skip, fixedId],
		};
	}
	if (input?.kind === "boarded") {
		const leg = route.legs[index];
		const board = leg ? boards.board(leg, "board") : null;
		const boarding = boardedVehicle(board, now, fixedId, new Set(state.skip));
		return {
			...state,
			boardedBy: replaceAt(state.boardedBy, index, "user"),
			fixed: replaceAt(state.fixed, index, boarding.vehicleId),
			readyAt: boarding.at,
			stage: "ride",
		};
	}
	return state;
}

/**
 * 잡은 차량이 승차 정류장을 지났으면(규칙 3): 정류장에 있을 시각 뒤에 지났으면 탄 것으로 보고,
 * 그 전에 지났으면 그 차량을 놓고 다시 고르게 한다.
 */
function checkPassed(
	state: SessionState,
	route: Route,
	boards: TransitBoards
): SessionState {
	const index = state.legIndex;
	const fixedId = state.fixed[index] ?? null;
	const leg = route.legs[index];
	if (fixedId === null || leg === undefined || state.readyAt === null) {
		return state;
	}
	const passedEntry = boards
		.board(leg, "board")
		?.passed.find((entry) => entry.vehicleId === fixedId);
	if (!passedEntry) {
		return state;
	}
	if (passedEntry.at >= state.readyAt) {
		return {
			...state,
			boardedBy: replaceAt(state.boardedBy, index, "time"),
			readyAt: passedEntry.at,
			stage: "ride",
		};
	}
	return {
		...state,
		fixed: replaceAt(state.fixed, index, null),
		passed: { lineName: leg.lineName },
		skip: state.skip.includes(fixedId) ? state.skip : [...state.skip, fixedId],
	};
}

/**
 * 탑승 전에는 지금보다 이른 시각에 탈 수 없으므로 readyAt을 now 뒤로 민다.
 * 탄 뒤의 readyAt은 탄 시각이라 그대로 넘긴다. 밀면 배차간격 추정의 하차 시각이 매번 뒤로 밀린다.
 */
function estimatePrimary(
	state: SessionState,
	route: Route,
	boards: TransitBoards,
	now: number,
	config: CommuteConfig
): RouteEstimate {
	const readyAt = state.readyAt ?? now;
	return estimateRoute(
		route,
		boards,
		{
			boardedLegs: state.boardedBy.map((by) => by !== null),
			fixed: state.fixed,
			fromLeg: state.legIndex,
			now,
			readyAt: state.stage === "ride" ? readyAt : Math.max(now, readyAt),
			skip: new Set(state.skip),
		},
		config
	);
}

/** 탄 차량이 하차 정류장에 닿았으면 내린 시각, 아니면 null(규칙 6). */
function alightedAt(
	state: SessionState,
	route: Route,
	boards: TransitBoards,
	estimate: RouteEstimate,
	now: number
): number | null {
	const index = state.legIndex;
	const leg = route.legs[index];
	const vehicleId = state.fixed[index] ?? null;
	if (leg === undefined) {
		return null;
	}
	if (vehicleId !== null) {
		const passedEntry = boards
			.board(leg, "alight")
			?.passed.find((entry) => entry.vehicleId === vehicleId);
		if (passedEntry) {
			return Math.min(now, passedEntry.at);
		}
	}
	// 탄 차량을 모르면 추정의 하차 시각은 뒤에 올 다른 차량의 것이라 쓰지 않는다.
	const alightEtaAt =
		vehicleId === null ? null : (estimate.legs[index]?.alightEtaAt ?? null);
	if (alightEtaAt !== null && alightEtaAt <= now) {
		return alightEtaAt;
	}
	if (vehicleId !== null && boards.progress(leg, vehicleId)?.stopsAway === 0) {
		return now;
	}
	return alightEtaAt === null
		? rideElapsedAt(state, leg, vehicleId, boards, now)
		: null;
}

/** 하차 추정이 없을 때: 탄 시각(readyAt) + 주행 시간이 지났으면 그 시각에 내린 것으로 본다. */
function rideElapsedAt(
	state: SessionState,
	leg: Leg,
	vehicleId: string | null,
	boards: TransitBoards,
	now: number
): number | null {
	const rideMs = boards.rideMs(leg, vehicleId);
	if (rideMs === null || state.readyAt === null) {
		return null;
	}
	const at = state.readyAt + rideMs;
	return at <= now ? at : null;
}

/** 내린 뒤: 다음 구간 walk, 마지막 구간이면 arrived. */
function leaveVehicle(
	state: SessionState,
	route: Route,
	at: number
): SessionState {
	const nextIndex = state.legIndex + 1;
	if (nextIndex >= route.legs.length) {
		return {
			...state,
			readyAt: at + minutesMs(route.walkMinutes[route.legs.length]),
			stage: "arrived",
		};
	}
	return {
		...state,
		legIndex: nextIndex,
		readyAt: at + minutesMs(route.walkMinutes[nextIndex]),
		stage: "walk",
	};
}

/** arrived 뒤 마지막 도보 + 여유가 지나면 끝낸다. */
function endIfArrived(
	state: SessionState,
	now: number,
	config: CommuteConfig
): SessionState {
	const isDone =
		state.stage === "arrived" &&
		state.readyAt !== null &&
		now >= state.readyAt + config.endGraceMs;
	return isDone ? endWith(state, "arrived") : state;
}

/**
 * 대안은 잡은 차량과 skip 없이 고른다. 나가는 시각(첫 구간 readyAt - 기본 경로 첫 도보)에
 * 그 대안의 첫 도보를 더한 시각부터 탈 수 있다고 본다.
 */
function estimateAlternatives(
	state: SessionState,
	plan: CommutePlan,
	primary: Route,
	boards: TransitBoards,
	now: number,
	config: CommuteConfig
): RouteEstimate[] {
	const readyAt = state.readyAt ?? now;
	const departAt = Math.max(now, readyAt - minutesMs(primary.walkMinutes[0]));
	return plan.routes
		.filter((route) => route !== primary)
		.map((route) =>
			estimateRoute(
				route,
				boards,
				{
					fixed: [],
					now,
					readyAt: departAt + minutesMs(route.walkMinutes[0]),
					skip: NO_SKIP,
				},
				config
			)
		);
}

/** 탑승 전 단계: 고른 차량을 잡고, 정류장에 있을 시각 전이면 walk, 아니면 wait(규칙 7). */
function settleBeforeBoarding(
	state: SessionState,
	estimate: RouteEstimate,
	now: number
): SessionState {
	const index = state.legIndex;
	const picked = estimate.legs[index]?.vehicleId ?? null;
	const fixed =
		(state.fixed[index] ?? null) === null && picked !== null
			? replaceAt(state.fixed, index, picked)
			: state.fixed;
	const readyAt = state.readyAt ?? now;
	return { ...state, fixed, stage: now < readyAt ? "walk" : "wait" };
}

/** 탑승 전·탑승 단계를 진행하고 estimates를 다시 계산한다. */
function progressSession(
	state: SessionState,
	plan: CommutePlan,
	route: Route,
	boards: TransitBoards,
	now: number,
	config: CommuteConfig,
	input: SessionInput | undefined
): SessionState {
	let next = state;
	if (isBeforeBoarding(next)) {
		next = applyInput(next, route, boards, now, input);
	}
	// 입력이 먼저다. "탔어요"로 이미 탔으면 시각 추정으로 다시 판단하지 않는다.
	if (isBeforeBoarding(next)) {
		next = checkPassed(next, route, boards);
	}
	let estimate = estimatePrimary(next, route, boards, now, config);
	if (next.stage === "ride") {
		const at = alightedAt(next, route, boards, estimate, now);
		if (at !== null) {
			next = leaveVehicle(next, route, at);
			if (next.stage === "arrived") {
				return { ...next, estimates: [estimate] };
			}
			estimate = estimatePrimary(next, route, boards, now, config);
		}
	}
	if (isBeforeBoarding(next)) {
		next = settleBeforeBoarding(next, estimate, now);
	}
	const hasBoarded = next.boardedBy.some((by) => by !== null);
	const alternatives = hasBoarded
		? []
		: estimateAlternatives(next, plan, route, boards, now, config);
	return { ...next, estimates: [estimate, ...alternatives] };
}

/**
 * 세션을 한 걸음 진행한다. 순수 함수이고 seq는 건드리지 않는다(보낼 때 올린다).
 * 끝난 세션은 입력과 관계없이 그대로 돌려준다.
 */
export function advance(
	state: SessionState,
	plan: CommutePlan,
	boards: TransitBoards,
	now: number,
	config: CommuteConfig,
	input?: SessionInput
): SessionState {
	if (state.stage === "ended") {
		return state;
	}
	if (input?.kind === "end") {
		return endWith(state, "user");
	}
	if (now - state.startedAt >= config.maxSessionMs) {
		return endWith(state, "timeout");
	}
	const route = primaryRoute(plan);
	if (route === undefined || state.legIndex >= route.legs.length) {
		return endWith(state, "plan-removed");
	}
	if (state.stage === "arrived") {
		return endIfArrived({ ...state, passed: null }, now, config);
	}
	const readyAt =
		state.readyAt ??
		Math.max(now, state.leaveAt) + minutesMs(route.walkMinutes[0]);
	const next = progressSession(
		{ ...state, passed: null, readyAt },
		plan,
		route,
		boards,
		now,
		config,
		input
	);
	const destinationEtaAt = next.estimates[0]?.destinationEtaAt ?? null;
	return endIfArrived(
		{
			...next,
			initialDestinationEtaAt: next.initialDestinationEtaAt ?? destinationEtaAt,
		},
		now,
		config
	);
}

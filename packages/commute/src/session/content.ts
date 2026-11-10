import type { CommuteConfig } from "../config";
import type { CommutePlan, Route } from "../plan";
import type { LegEstimate, RouteEstimate } from "./estimate";
import type { SessionState, Stage } from "./stage";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;
const PRIORITY_STAGE = 10;
const PRIORITY_CHANGE = 5;

/** 푸시로 보내는 값 v1(스펙 5.3). 시각은 epoch 초. 문장은 기기가 만든다. */
export interface ContentState {
	/** 처음 계산한 목적지 도착보다 늦어진 분(0 이상). */
	delayMinutes: number;
	/** 목적지 도착 예상. */
	destinationEtaEpoch: number | null;
	/** stopName에 도착하는 시각. */
	etaEpoch: number | null;
	etaState: "live" | "estimated";
	/** 첫 구간 walk 단계의 나가는 시각. 그 밖에는 null. */
	leaveEpoch: number | null;
	legCount: number;
	legIndex: number;
	lineName: string;
	mode: "bus" | "subway";
	passed: { lineName: string } | null;
	positionState: "live" | "stale" | "none";
	sentAt: number;
	/** 세션 안에서 보낼 때마다 1씩 오른다. 기기는 더 작은 값을 버린다. */
	seq: number;
	stage: Stage;
	/** walk·wait: 승차 정류장, ride·arrived: 하차 정류장. */
	stopName: string;
	stopsAway: number | null;
	suggestion: {
		boardEtaEpoch: number;
		lineName: string;
		mode: "bus" | "subway";
		rank: number;
		savesMinutes: number;
	} | null;
	v: 1;
}

export type SendDecision =
	| { send: false }
	| {
			send: true;
			priority: 5 | 10;
			reason: "change" | "stage" | "heartbeat";
	  };

function toEpoch(ms: number): number {
	return Math.floor(ms / MS_PER_SECOND);
}

function toEpochOrNull(ms: number | null | undefined): number | null {
	return ms === null || ms === undefined ? null : toEpoch(ms);
}

function minuteOf(epochSec: number | null): number | null {
	return epochSec === null ? null : Math.floor(epochSec / SECONDS_PER_MINUTE);
}

function routeOf(plan: CommutePlan, rank: number): Route | undefined {
	return plan.routes.find((route) => route.rank === rank);
}

function isBeforeBoarding(stage: Stage): boolean {
	return stage === "walk" || stage === "wait";
}

function delayMinutesOf(
	state: SessionState,
	primary: RouteEstimate | undefined
) {
	const initial = state.initialDestinationEtaAt;
	const current = primary?.destinationEtaAt ?? null;
	if (initial === null || current === null) {
		return 0;
	}
	return Math.max(0, Math.floor((current - initial) / MS_PER_MINUTE));
}

/** 탑승 전이고 3분(설정) 이상 빠른 대안 중 가장 빠른 것. 확신이 없으면 제안하지 않는다. */
function suggestionOf(
	state: SessionState,
	plan: CommutePlan,
	config: CommuteConfig
): ContentState["suggestion"] {
	if (!isBeforeBoarding(state.stage)) {
		return null;
	}
	const primaryEta = state.estimates.find(
		(entry) => entry.rank === 0
	)?.destinationEtaAt;
	if (primaryEta === null || primaryEta === undefined) {
		return null;
	}
	let best: {
		estimate: RouteEstimate;
		eta: number;
		boardEtaAt: number;
	} | null = null;
	for (const estimate of state.estimates) {
		const [first] = estimate.legs;
		const eta = estimate.destinationEtaAt;
		if (
			estimate.rank === 0 ||
			eta === null ||
			first === undefined ||
			first.etaState === "estimated" ||
			first.boardEtaAt === null ||
			primaryEta - eta < config.suggestMinGainMs
		) {
			continue;
		}
		if (best === null || eta < best.eta) {
			best = { boardEtaAt: first.boardEtaAt, estimate, eta };
		}
	}
	if (best === null) {
		return null;
	}
	const leg = routeOf(plan, best.estimate.rank)?.legs[0];
	if (leg === undefined) {
		return null;
	}
	return {
		boardEtaEpoch: toEpoch(best.boardEtaAt),
		lineName: leg.lineName,
		mode: leg.mode,
		rank: best.estimate.rank,
		savesMinutes: Math.floor((primaryEta - best.eta) / MS_PER_MINUTE),
	};
}

/** 지금 상태를 푸시 값으로 만든다. seq는 보낼 때마다 오르므로 state.seq + 1. */
export function buildContent(
	state: SessionState,
	plan: CommutePlan,
	now: number,
	config: CommuteConfig
): ContentState {
	const route = routeOf(plan, 0);
	const legCount = route?.legs.length ?? 0;
	const legIndex = Math.max(0, Math.min(state.legIndex, legCount - 1));
	const leg = route?.legs[legIndex];
	const primary = state.estimates.find((entry) => entry.rank === 0);
	const legEstimate: LegEstimate | undefined = primary?.legs[legIndex];
	const boarding = isBeforeBoarding(state.stage);
	const etaAt = boarding ? legEstimate?.boardEtaAt : legEstimate?.alightEtaAt;
	const stopName = boarding ? leg?.board.name : leg?.alight.name;
	const showsLeave = state.stage === "walk" && legIndex === 0;

	return {
		delayMinutes: delayMinutesOf(state, primary),
		destinationEtaEpoch: toEpochOrNull(primary?.destinationEtaAt),
		etaEpoch: toEpochOrNull(etaAt),
		etaState: legEstimate?.etaState ?? "estimated",
		leaveEpoch: showsLeave ? toEpoch(state.leaveAt) : null,
		legCount,
		legIndex,
		lineName: leg?.lineName ?? "",
		mode: leg?.mode ?? "bus",
		passed: state.passed ? { lineName: state.passed.lineName } : null,
		positionState: legEstimate?.positionState ?? "none",
		sentAt: toEpoch(now),
		seq: state.seq + 1,
		stage: state.stage,
		stopName: stopName ?? "",
		stopsAway: legEstimate?.stopsAway ?? null,
		suggestion: suggestionOf(state, plan, config),
		v: 1,
	};
}

function isStageChange(prev: ContentState, next: ContentState): boolean {
	return (
		prev.stage !== next.stage ||
		prev.legIndex !== next.legIndex ||
		prev.lineName !== next.lineName ||
		(prev.passed === null) !== (next.passed === null) ||
		(prev.suggestion === null) !== (next.suggestion === null) ||
		prev.suggestion?.rank !== next.suggestion?.rank
	);
}

function isValueChange(prev: ContentState, next: ContentState): boolean {
	return (
		prev.stopsAway !== next.stopsAway ||
		minuteOf(prev.etaEpoch) !== minuteOf(next.etaEpoch) ||
		prev.positionState !== next.positionState ||
		prev.etaState !== next.etaState ||
		prev.delayMinutes !== next.delayMinutes ||
		prev.suggestion?.savesMinutes !== next.suggestion?.savesMinutes ||
		minuteOf(prev.destinationEtaEpoch) !== minuteOf(next.destinationEtaEpoch)
	);
}

/** 보낼지 정한다. 단계 변화는 높은 우선순위, 표시가 바뀐 값은 낮은 우선순위, 오래 조용하면 heartbeat. */
export function decideSend(
	prev: ContentState | null,
	next: ContentState,
	lastSentAt: number | null,
	now: number,
	config: CommuteConfig
): SendDecision {
	if (prev === null) {
		return { priority: PRIORITY_STAGE, reason: "stage", send: true };
	}
	if (isStageChange(prev, next)) {
		return { priority: PRIORITY_STAGE, reason: "stage", send: true };
	}
	if (isValueChange(prev, next)) {
		return { priority: PRIORITY_CHANGE, reason: "change", send: true };
	}
	if (lastSentAt === null || now - lastSentAt >= config.heartbeatMs) {
		return { priority: PRIORITY_CHANGE, reason: "heartbeat", send: true };
	}
	return { send: false };
}

/** iOS 시작 푸시의 attributes. */
export function activityAttributes(state: SessionState): {
	planId: string;
	sessionId: string;
} {
	return { planId: state.planId, sessionId: state.sessionId };
}

import { localParts } from "./calendar";
import type { CommuteConfig } from "./config";
import { marginSecFor } from "./config";
import type { CommutePlan, Leg, Route } from "./plan";
import type { LineRef, StopRef } from "./refs";
import { parseRef } from "./refs";
import type { ContentState, LeaveShown } from "./session/content";
import { leaveShownAt } from "./session/content";
import type { LegEstimate } from "./session/estimate";
import type { EndReason, SessionInput, SessionState } from "./session/stage";
import type { ArrivalMethod, StopBoard, TransitBoards } from "./sources/types";

const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
/** 7.1: 차량이 내 정류장에 오기 5분 전 시점의 예측을 잰다. */
const TARGET_LEAD_MS = 5 * MINUTE_MS;
/** 5분 전에서 이만큼 안의 예측만 후보다(실험 6과 같다). */
const LEAD_TOLERANCE_MS = MINUTE_MS;
/** 7.1의 두 기준(±1분, ±2분). 자동 시작 ±1분도 같은 값이다. */
const WITHIN_60_MS = MINUTE_MS;
const WITHIN_120_MS = 2 * MINUTE_MS;
const ON_TIME_MS = MINUTE_MS;
const HALF = 2;
/** 경계 지연이 이보다 길면 실패로 센다(스펙 5장). */
const BOUNDARY_LATE_MS = 30_000;

/**
 * 정확도 기록 한 줄(5.4). 세션이 끝나면 모아서 요약하고 R2에 남긴다.
 * 설치 ID, 푸시 토큰, 키는 넣지 않는다.
 */
export type AccuracyRecord =
	| {
			kind: "prediction";
			at: number;
			sessionId: string;
			planId: string;
			rank: number;
			legIndex: number;
			line: LineRef;
			stop: StopRef;
			direction: string | null;
			vehicleId: string;
			etaAt: number;
			method: ArrivalMethod;
			positionState: string;
			etaState: string;
			stopsAway: number | null;
			sourceAt: number;
			/** 예상 도착(`etaAt`)의 현지 요일·분. 나중에 요일·시각대로 묶어 본다. */
			weekday: number;
			localMinute: number;
	  }
	| {
			/** 실제 도착은 `low`(직전 도착판)와 `high`(차량이 지난 것을 본 도착판) 사이다. */
			kind: "arrival";
			sessionId: string;
			line: LineRef;
			stop: StopRef;
			vehicleId: string;
			low: number;
			high: number;
	  }
	| {
			kind: "input";
			at: number;
			sessionId: string;
			input: "boarded" | "next" | "end";
			vehicleId: string | null;
	  }
	| {
			/**
			 * 제안이 나간 시각의 두 차량. `afterAlightMs`는 그 차량에서 내린 뒤 목적지까지의 예상
			 * (`destinationEtaAt - 하차 예정`, 구간이 하나면 마지막 도보)이다.
			 */
			kind: "suggestion";
			at: number;
			sessionId: string;
			primary: SuggestedVehicle;
			alternative: SuggestedVehicle & { rank: number };
	  }
	| {
			kind: "start";
			sessionId: string;
			dueAt: number;
			sentAt: number;
			shownAt: number | null;
			tokenAt: number | null;
	  }
	| {
			kind: "send";
			at: number;
			sessionId: string;
			seq: number;
			reason: string;
			outcome: string;
	  }
	| {
			/**
			 * 첫 구간 도보에서 실제로 보낸 나가는 시각(스펙 4.7). `shown`은 보낸 시각에 기기가 고른 문장이고,
			 * `safeLeaveAt`은 보낸 `safeLeaveEpoch`(밀리초)다. 차량은 여유를 판단한 차량, 없으면 잡은 차량.
			 * 도보가 끝나 나가는 시각이 화면에서 내려가면 그 값을 보낸 시각에 `shown: "none"`,
			 * `safeLeaveAt: null`로 한 번 더 남는다.
			 */
			kind: "leave";
			at: number;
			sessionId: string;
			line: LineRef;
			stop: StopRef;
			vehicleId: string | null;
			leaveAt: number;
			safeLeaveAt: number | null;
			firstWalkMs: number;
			marginSec: number;
			shown: LeaveShown;
	  }
	| {
			/** 세션이 닫힌 시각과 이유. 요약의 `planId`, `endReason`이 여기서 나온다. */
			kind: "end";
			at: number;
			sessionId: string;
			planId: string;
			reason: EndReason;
			/** 일찍 나가서 탄(`boardedBy: "early"`) 구간이 있었는가. 배포 전 기록에는 키가 없다. */
			boardedEarly?: boolean;
	  };

export interface SuggestedVehicle {
	afterAlightMs: number;
	alightStop: StopRef;
	destinationEtaAt: number;
	vehicleId: string;
}

type PredictionRecord = Extract<AccuracyRecord, { kind: "prediction" }>;
type ArrivalRecord = Extract<AccuracyRecord, { kind: "arrival" }>;
type SuggestionRecord = Extract<AccuracyRecord, { kind: "suggestion" }>;
export type LeaveRecord = Extract<AccuracyRecord, { kind: "leave" }>;

/** 마지막으로 남긴 `leave` 기록의 세 값. 셋이 모두 같으면 다시 남기지 않는다. */
export interface LeaveMark {
	safeLeaveAt: number | null;
	shown: LeaveShown;
	vehicleId: string | null;
}

/** 세션 하나의 나가는 시각 판정(스펙 4.7). */
export interface LeaveSummary {
	/** 마지막 `safe` 기록의 `safeLeaveAt`부터 그 뒤 첫 `boundary` ok 보낸 기록까지. */
	boundaryDelayMs: number | null;
	/** `safe`로 판정했고 도착을 쟀을 때만 `max(0, low − ready)`. */
	overWaitMs: number | null;
	sawSafe: boolean;
	sawTight: boolean;
	/** 판정한 기록의 문장. `tightOnly`면 null. */
	shown: "roomy" | "safe" | null;
	verdict: "sure" | "boundary" | "wrong" | "unknown" | "tightOnly";
}

export interface SessionSummary {
	/** 일찍 나가서 탄 세션인가. 배포 전에 저장된 요약에는 키가 없다(undefined는 false와 같다). */
	earlyBoarded?: boolean;
	endReason: EndReason;
	/** 나가는 시각 판정. `none` 말고 남은 기록이 없으면 null. 옛 요약에는 키가 없다(undefined는 null과 같다). */
	leave?: LeaveSummary | null;
	maxSendGapMs: number;
	planId: string;
	predictions: {
		line: LineRef;
		stop: StopRef;
		method: ArrivalMethod;
		errorMs: number;
		halfWidthMs: number;
		leadMs: number;
	}[];
	sessionId: string;
	startDelayMs: number | null;
	suggestions: {
		verdict: "faster" | "slower" | "unknown";
		gainMs: number | null;
	}[];
}

export interface DailyCommuteReport {
	/** 키는 `<출처>|<방법>`(예: `seoul-bus|official`). `medianErrorMs`는 부호 있는 오차의 가운데 값. */
	accuracy: Record<
		string,
		{ n: number; within60: number; within120: number; medianErrorMs: number }
	>;
	date: string;
	endReasons: Record<string, number>;
	leave: LeaveReport;
	maxSendGapMs: number;
	sessions: number;
	/** `onTime`은 `startDelayMs`가 ±60초 안이다. */
	starts: { late: number; onTime: number; unknown: number };
	suggestions: { faster: number; slower: number; unknown: number };
}

/**
 * 하루치 나가는 시각 판정(스펙 4.7). `sessions`는 `leave` 요약이 있는 세션 수, `earlyBoarded`는 모든 세션에서 센다.
 * `rateLow`·`rateHigh`의 분모는 잰 세션(sure + boundary + wrong)이고, `rateSafeOrTight`의 분모는
 * `sessions`다. 분모가 0이면 null이다.
 */
export interface LeaveReport {
	boundary: number;
	boundaryDelayMaxMs: number | null;
	/** 경계 지연이 30초를 넘은 세션 수. */
	boundaryLate: number;
	earlyBoarded: number;
	overWaitMeanMs: number | null;
	rateHigh: number | null;
	rateLow: number | null;
	/** `sawSafeOrTight ÷ sessions`. 과잉 보수를 막는 지표(스펙 4.7). */
	rateSafeOrTight: number | null;
	sawSafe: number;
	/** safe나 tight 기록이 하나라도 있는 세션 수. 둘 다 있는 세션은 한 번만 센다. */
	sawSafeOrTight: number;
	sawTight: number;
	sessions: number;
	/** unknown이 잰 세션보다 많으면 "undecidable". */
	status: "ok" | "undecidable";
	sure: number;
	tightOnly: number;
	unknown: number;
	wrong: number;
}

function routeOf(plan: CommutePlan, rank: number): Route | undefined {
	return plan.routes.find((route) => route.rank === rank);
}

function isBeforeBoarding(state: SessionState): boolean {
	return state.stage === "walk" || state.stage === "wait";
}

function predictionOf(
	state: SessionState,
	rank: number,
	legIndex: number,
	leg: Leg,
	estimate: LegEstimate,
	board: StopBoard | null,
	now: number,
	timezone: string
): PredictionRecord | null {
	const { boardEtaAt, method, vehicleId } = estimate;
	if (
		vehicleId === null ||
		boardEtaAt === null ||
		method === null ||
		board === null
	) {
		return null;
	}
	const local = localParts(boardEtaAt, timezone);
	return {
		at: now,
		direction: leg.mode === "subway" ? leg.direction : null,
		etaAt: boardEtaAt,
		etaState: estimate.etaState,
		kind: "prediction",
		legIndex,
		line: leg.line,
		localMinute: local.minute,
		method,
		planId: state.planId,
		positionState: estimate.positionState,
		rank,
		sessionId: state.sessionId,
		sourceAt: board.sourceAt,
		stop: leg.board.stop,
		stopsAway: estimate.stopsAway,
		vehicleId,
		weekday: local.weekday,
	};
}

/** 탑승 전: 기본 경로는 지금 구간, 대안은 첫 구간의 승차 정류장 예측. */
function predictionsOf(
	next: SessionState,
	boards: TransitBoards,
	plan: CommutePlan,
	now: number,
	timezone: string
): PredictionRecord[] {
	if (!isBeforeBoarding(next)) {
		return [];
	}
	const records: PredictionRecord[] = [];
	for (const estimate of next.estimates) {
		const legIndex = estimate.rank === 0 ? next.legIndex : 0;
		const leg = routeOf(plan, estimate.rank)?.legs[legIndex];
		const legEstimate = estimate.legs[legIndex];
		if (leg === undefined || legEstimate === undefined) {
			continue;
		}
		const record = predictionOf(
			next,
			estimate.rank,
			legIndex,
			leg,
			legEstimate,
			boards.board(leg, "board"),
			now,
			timezone
		);
		if (record) {
			records.push(record);
		}
	}
	return records;
}

/** 도착판의 `passed`에 그 차량이 있으면 실제 도착 기록. */
export function arrivalRecordOf(
	sessionId: string,
	leg: Leg,
	side: "board" | "alight",
	board: StopBoard | null,
	vehicleId: string
): ArrivalRecord | null {
	const entry = board?.passed.find((item) => item.vehicleId === vehicleId);
	if (!(board && entry)) {
		return null;
	}
	return {
		high: entry.at,
		kind: "arrival",
		line: leg.line,
		low: board.prevSourceAt ?? entry.at,
		sessionId,
		stop: leg[side].stop,
		vehicleId,
	};
}

/**
 * 직전 상태가 그 정류장에 오는 것으로 보던 차량(승차 시각 또는 하차 시각이 있던 차량)이
 * 이번 도착판에서 지났으면 남긴다. 다음 tick의 직전 상태는 그 차량을 더 이상 그 정류장으로
 * 오는 것으로 보지 않으므로, 도착판이 그대로여도 다시 남기지 않는다.
 */
function arrivalsOf(
	prev: SessionState | null,
	boards: TransitBoards,
	plan: CommutePlan
): ArrivalRecord[] {
	if (prev === null) {
		return [];
	}
	const records: ArrivalRecord[] = [];
	const seen = new Set<string>();
	const add = (record: ArrivalRecord | null): void => {
		const key = record ? `${record.stop}|${record.vehicleId}` : "";
		if (record && !seen.has(key)) {
			seen.add(key);
			records.push(record);
		}
	};
	for (const estimate of prev.estimates) {
		const route = routeOf(plan, estimate.rank);
		for (const [index, legEstimate] of estimate.legs.entries()) {
			const leg = route?.legs[index];
			const { vehicleId } = legEstimate;
			if (leg === undefined || vehicleId === null) {
				continue;
			}
			if (legEstimate.boardEtaAt !== null) {
				add(
					arrivalRecordOf(
						prev.sessionId,
						leg,
						"board",
						boards.board(leg, "board"),
						vehicleId
					)
				);
			}
			if (legEstimate.alightEtaAt !== null) {
				add(
					arrivalRecordOf(
						prev.sessionId,
						leg,
						"alight",
						boards.board(leg, "alight"),
						vehicleId
					)
				);
			}
		}
	}
	return records;
}

/**
 * tick 하나의 기록: 탑승 전이면 기본 경로(지금 구간)와 대안(첫 구간)의 승차 예측, 그리고
 * 새로 지난 차량의 실제 도착. `prev`는 이번 tick의 advance 전 상태다.
 */
export function recordsOf(
	prev: SessionState | null,
	next: SessionState,
	boards: TransitBoards,
	plan: CommutePlan,
	now: number,
	timezone: string
): AccuracyRecord[] {
	return [
		...predictionsOf(next, boards, plan, now, timezone),
		...arrivalsOf(prev, boards, plan),
	];
}

/** 사용자 입력. "탔어요"는 탄 차량, "다음 차"와 "끝"은 그때 잡아 두었던 차량. */
export function inputRecordOf(
	prev: SessionState,
	next: SessionState,
	input: SessionInput,
	at: number
): AccuracyRecord {
	const index = prev.legIndex;
	const vehicleId =
		input.kind === "boarded"
			? (next.fixed[index] ?? null)
			: (prev.fixed[index] ?? null);
	return {
		at,
		input: input.kind,
		kind: "input",
		sessionId: prev.sessionId,
		vehicleId,
	};
}

/** 제안 판정을 위해 하차 정류장까지 따라갈 차량. */
export interface FollowTarget {
	leg: Leg;
	vehicleId: string;
}

function suggestedVehicle(
	leg: Leg | undefined,
	estimate: LegEstimate | undefined,
	destinationEtaAt: number | null | undefined
): SuggestedVehicle | null {
	if (
		leg === undefined ||
		estimate?.vehicleId === null ||
		estimate?.vehicleId === undefined ||
		estimate.alightEtaAt === null ||
		destinationEtaAt === null ||
		destinationEtaAt === undefined
	) {
		return null;
	}
	return {
		afterAlightMs: destinationEtaAt - estimate.alightEtaAt,
		alightStop: leg.alight.stop,
		destinationEtaAt,
		vehicleId: estimate.vehicleId,
	};
}

/**
 * 대안 `rank`를 제안했을 때의 기록. 기본 경로는 지금 구간, 대안은 첫 구간의 탈 차량이다.
 * 어느 쪽이든 차량이나 시각을 모르면 판정할 수 없으므로 null.
 */
export function suggestionRecordOf(
	state: SessionState,
	plan: CommutePlan,
	rank: number,
	at: number
): { follow: FollowTarget[]; record: SuggestionRecord } | null {
	const primaryEstimate = state.estimates.find((entry) => entry.rank === 0);
	const altEstimate = state.estimates.find((entry) => entry.rank === rank);
	const primaryLeg = routeOf(plan, 0)?.legs[state.legIndex];
	const altLeg = routeOf(plan, rank)?.legs[0];
	const primary = suggestedVehicle(
		primaryLeg,
		primaryEstimate?.legs[state.legIndex],
		primaryEstimate?.destinationEtaAt
	);
	const alternative = suggestedVehicle(
		altLeg,
		altEstimate?.legs[0],
		altEstimate?.destinationEtaAt
	);
	if (!(primary && alternative && primaryLeg && altLeg)) {
		return null;
	}
	return {
		follow: [
			{ leg: primaryLeg, vehicleId: primary.vehicleId },
			{ leg: altLeg, vehicleId: alternative.vehicleId },
		],
		record: {
			alternative: { ...alternative, rank },
			at,
			kind: "suggestion",
			primary,
			sessionId: state.sessionId,
		},
	};
}

function msOrNull(epochSec: number | null | undefined): number | null {
	return epochSec === null || epochSec === undefined
		? null
		: epochSec * SECOND_MS;
}

/**
 * 보낸 값 기준의 `leave` 기록(스펙 4.7). 보낸 뒤에만 부른다.
 * 첫 구간 도보 밖에서 보낸 값은 나가는 시각이 화면에서 내려간 것이라, 마지막 기록이 `none`이
 * 아니면 `shown: "none"`으로 한 번 남기고 그 뒤로는 null이다. 문장·safeLeaveAt·차량이 `last`와
 * 같아도 null.
 */
export function leaveRecordOf(
	state: SessionState,
	sent: ContentState,
	plan: CommutePlan,
	config: CommuteConfig,
	last: LeaveMark | null
): LeaveRecord | null {
	const route = routeOf(plan, 0);
	const leg = route?.legs[0];
	if (route === undefined || leg === undefined) {
		return null;
	}
	const isFirstWalk = sent.stage === "walk" && sent.legIndex === 0;
	const hasLeftScreen = !isFirstWalk && last !== null && last.shown !== "none";
	if (!(isFirstWalk || hasLeftScreen)) {
		return null;
	}
	const shown: LeaveShown = isFirstWalk
		? leaveShownAt(sent, sent.sentAt)
		: "none";
	const safeLeaveAt = isFirstWalk ? msOrNull(sent.safeLeaveEpoch) : null;
	const vehicleId = state.leave?.vehicleId ?? state.fixed[0] ?? null;
	const isSameAsLast =
		last !== null &&
		last.shown === shown &&
		last.safeLeaveAt === safeLeaveAt &&
		last.vehicleId === vehicleId;
	if (isSameAsLast) {
		return null;
	}
	return {
		at: sent.sentAt * SECOND_MS,
		firstWalkMs: (route.walkMinutes[0] ?? 0) * MINUTE_MS,
		kind: "leave",
		leaveAt: state.leaveAt,
		line: leg.line,
		marginSec: marginSecFor(config, leg.mode, leg.line),
		safeLeaveAt,
		sessionId: state.sessionId,
		shown,
		stop: leg.board.stop,
		vehicleId,
	};
}

function midOf(record: ArrivalRecord): number {
	return (record.low + record.high) / HALF;
}

/** 정류장·차량마다 처음 남은 도착 하나. */
function firstArrivals(records: AccuracyRecord[]): Map<string, ArrivalRecord> {
	const arrivals = new Map<string, ArrivalRecord>();
	for (const record of records) {
		if (record.kind !== "arrival") {
			continue;
		}
		const key = `${record.stop}|${record.vehicleId}`;
		if (!arrivals.has(key)) {
			arrivals.set(key, record);
		}
	}
	return arrivals;
}

/** 실제 도착 가운데 값 5분 전에서 ±60초 안의 예측 중 5분에 가장 가까운 것 하나. */
function scorePredictions(
	arrivals: Map<string, ArrivalRecord>,
	predictions: PredictionRecord[]
): SessionSummary["predictions"] {
	const scored: SessionSummary["predictions"] = [];
	for (const arrival of arrivals.values()) {
		const mid = midOf(arrival);
		let best: { distance: number; record: PredictionRecord } | null = null;
		for (const record of predictions) {
			if (
				record.stop !== arrival.stop ||
				record.vehicleId !== arrival.vehicleId
			) {
				continue;
			}
			const distance = Math.abs(mid - record.at - TARGET_LEAD_MS);
			if (
				distance <= LEAD_TOLERANCE_MS &&
				(best === null || distance < best.distance)
			) {
				best = { distance, record };
			}
		}
		if (best) {
			scored.push({
				errorMs: best.record.etaAt - mid,
				halfWidthMs: (arrival.high - arrival.low) / HALF,
				leadMs: mid - best.record.at,
				line: arrival.line,
				method: best.record.method,
				stop: arrival.stop,
			});
		}
	}
	return scored;
}

function judgeSuggestion(
	record: SuggestionRecord,
	arrivals: Map<string, ArrivalRecord>
): SessionSummary["suggestions"][number] {
	const primary = arrivals.get(
		`${record.primary.alightStop}|${record.primary.vehicleId}`
	);
	const alternative = arrivals.get(
		`${record.alternative.alightStop}|${record.alternative.vehicleId}`
	);
	if (!(primary && alternative)) {
		return { gainMs: null, verdict: "unknown" };
	}
	const gainMs =
		midOf(primary) +
		record.primary.afterAlightMs -
		(midOf(alternative) + record.alternative.afterAlightMs);
	return { gainMs, verdict: gainMs > 0 ? "faster" : "slower" };
}

/** "보여 준 나가는 시각 + 첫 도보"(ready)를 그 차량의 실제 도착 구간과 비교한다. */
function judgeLeave(
	record: LeaveRecord,
	arrivals: Map<string, ArrivalRecord>
): Pick<LeaveSummary, "overWaitMs" | "verdict"> {
	const shownLeaveAt =
		record.shown === "roomy" ? record.leaveAt : record.safeLeaveAt;
	const arrival =
		record.vehicleId === null
			? undefined
			: arrivals.get(`${record.stop}|${record.vehicleId}`);
	if (shownLeaveAt === null || arrival === undefined) {
		return { overWaitMs: null, verdict: "unknown" };
	}
	const ready = shownLeaveAt + record.firstWalkMs;
	let verdict: LeaveSummary["verdict"] = "wrong";
	if (ready <= arrival.low) {
		verdict = "sure";
	} else if (ready <= arrival.high) {
		verdict = "boundary";
	}
	// roomy는 배차 때문에 기다리는 시간이 섞여 과잉 대기에 넣지 않는다.
	const overWaitMs =
		record.shown === "safe" ? Math.max(0, arrival.low - ready) : null;
	return { overWaitMs, verdict };
}

/**
 * 마지막 safe 기록의 safeLeaveAt부터 그 뒤 첫 boundary ok 보낸 기록까지.
 * safeLeaveAt 전에 다른 문장으로 바뀌었으면 그 시각에 내릴 "여유 있어요"가 없으니 null이다.
 */
function boundaryDelayOf(
	records: AccuracyRecord[],
	leaves: LeaveRecord[],
	lastSafe: LeaveRecord | null
): number | null {
	const from = lastSafe?.safeLeaveAt ?? null;
	if (lastSafe === null || from === null) {
		return null;
	}
	const replaced = leaves[leaves.indexOf(lastSafe) + 1];
	const isWithdrawnInTime = replaced !== undefined && replaced.at < from;
	if (isWithdrawnInTime) {
		return null;
	}
	let first: number | null = null;
	for (const record of records) {
		const isBoundaryOk =
			record.kind === "send" &&
			record.reason === "boundary" &&
			record.outcome === "ok" &&
			record.at >= from;
		if (isBoundaryOk && (first === null || record.at < first)) {
			first = record.at;
		}
	}
	return first === null ? null : first - from;
}

/** 세션의 나가는 시각 판정. 마지막 roomy·safe 기록 하나로 판정하고, 없으면 tightOnly. */
function leaveSummaryOf(
	records: AccuracyRecord[],
	arrivals: Map<string, ArrivalRecord>
): LeaveSummary | null {
	const leaves = records.filter(
		(record): record is LeaveRecord => record.kind === "leave"
	);
	if (!leaves.some((record) => record.shown !== "none")) {
		return null;
	}
	const judged =
		leaves.findLast(
			(record) => record.shown === "roomy" || record.shown === "safe"
		) ?? null;
	const lastSafe = leaves.findLast((record) => record.shown === "safe") ?? null;
	const seen = {
		boundaryDelayMs: boundaryDelayOf(records, leaves, lastSafe),
		sawSafe: lastSafe !== null,
		sawTight: leaves.some((record) => record.shown === "tight"),
	};
	if (judged === null) {
		return { ...seen, overWaitMs: null, shown: null, verdict: "tightOnly" };
	}
	return {
		...seen,
		...judgeLeave(judged, arrivals),
		shown: judged.shown === "roomy" ? "roomy" : "safe",
	};
}

function maxOkGap(records: AccuracyRecord[]): number {
	const times = records
		.filter((record) => record.kind === "send" && record.outcome === "ok")
		.map((record) => (record.kind === "send" ? record.at : 0))
		.sort((a, b) => a - b);
	let gap = 0;
	for (const [index, time] of times.entries()) {
		const before = times[index - 1];
		if (before !== undefined) {
			gap = Math.max(gap, time - before);
		}
	}
	return gap;
}

/** 세션 하나의 기록 → 요약. */
export function summarize(records: AccuracyRecord[]): SessionSummary {
	const predictions = records.filter(
		(record): record is PredictionRecord => record.kind === "prediction"
	);
	const arrivals = firstArrivals(records);
	let start: Extract<AccuracyRecord, { kind: "start" }> | null = null;
	let end: Extract<AccuracyRecord, { kind: "end" }> | null = null;
	const suggestions: SessionSummary["suggestions"] = [];
	for (const record of records) {
		if (record.kind === "start") {
			start = record;
		} else if (record.kind === "end") {
			end = record;
		} else if (record.kind === "suggestion") {
			suggestions.push(judgeSuggestion(record, arrivals));
		}
	}
	const shownAt = start ? (start.shownAt ?? start.tokenAt) : null;
	return {
		earlyBoarded: end?.boardedEarly === true,
		endReason: end?.reason ?? "user",
		leave: leaveSummaryOf(records, arrivals),
		maxSendGapMs: maxOkGap(records),
		planId: end?.planId ?? predictions[0]?.planId ?? "",
		predictions: scorePredictions(arrivals, predictions),
		sessionId: records[0]?.sessionId ?? "",
		startDelayMs: start && shownAt !== null ? shownAt - start.dueAt : null,
		suggestions,
	};
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / HALF);
	if (sorted.length % HALF === 1) {
		return sorted[middle] ?? 0;
	}
	return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / HALF;
}

function countStarts(
	summaries: SessionSummary[]
): DailyCommuteReport["starts"] {
	const starts = { late: 0, onTime: 0, unknown: 0 };
	for (const { startDelayMs } of summaries) {
		if (startDelayMs === null) {
			starts.unknown += 1;
		} else if (Math.abs(startDelayMs) <= ON_TIME_MS) {
			starts.onTime += 1;
		} else {
			starts.late += 1;
		}
	}
	return starts;
}

function accuracyOf(
	summaries: SessionSummary[]
): DailyCommuteReport["accuracy"] {
	const errors = new Map<string, number[]>();
	for (const summary of summaries) {
		for (const prediction of summary.predictions) {
			const key = `${parseRef(prediction.line).source}|${prediction.method}`;
			const list = errors.get(key) ?? [];
			list.push(prediction.errorMs);
			errors.set(key, list);
		}
	}
	const accuracy: DailyCommuteReport["accuracy"] = {};
	for (const [key, list] of errors) {
		accuracy[key] = {
			medianErrorMs: median(list),
			n: list.length,
			within60: list.filter((error) => Math.abs(error) <= WITHIN_60_MS).length,
			within120: list.filter((error) => Math.abs(error) <= WITHIN_120_MS)
				.length,
		};
	}
	return accuracy;
}

function isNumber(value: number | null): value is number {
	return value !== null;
}

function ratioOf(part: number, whole: number): number | null {
	return whole === 0 ? null : part / whole;
}

function meanOf(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 옛 요약에 `leave`·`earlyBoarded` 키가 없어도 던지지 않는다. */
function leaveReportOf(summaries: SessionSummary[]): LeaveReport {
	const leaves = summaries
		.map((summary) => summary.leave ?? null)
		.filter((leave): leave is LeaveSummary => leave !== null);
	const counts = { boundary: 0, sure: 0, tightOnly: 0, unknown: 0, wrong: 0 };
	for (const { verdict } of leaves) {
		counts[verdict] += 1;
	}
	const measured = counts.sure + counts.boundary + counts.wrong;
	const delays = leaves.map((leave) => leave.boundaryDelayMs).filter(isNumber);
	const sawSafeOrTight = leaves.filter(
		(leave) => leave.sawSafe || leave.sawTight
	).length;
	return {
		...counts,
		boundaryDelayMaxMs: delays.length === 0 ? null : Math.max(...delays),
		boundaryLate: delays.filter((delay) => delay > BOUNDARY_LATE_MS).length,
		earlyBoarded: summaries.filter((summary) => summary.earlyBoarded === true)
			.length,
		overWaitMeanMs: meanOf(
			leaves.map((leave) => leave.overWaitMs).filter(isNumber)
		),
		rateHigh: ratioOf(counts.sure + counts.boundary, measured),
		rateLow: ratioOf(counts.sure, measured),
		rateSafeOrTight: ratioOf(sawSafeOrTight, leaves.length),
		sawSafe: leaves.filter((leave) => leave.sawSafe).length,
		sawSafeOrTight,
		sawTight: leaves.filter((leave) => leave.sawTight).length,
		sessions: leaves.length,
		status: counts.unknown > measured ? "undecidable" : "ok",
	};
}

/** 하루치 세션 요약 → 일일 보고서(7.1 기준을 매일 본다). 요약이 없어도 던지지 않는다. */
export function dailyReport(
	date: string,
	summaries: SessionSummary[]
): DailyCommuteReport {
	const endReasons: Record<string, number> = {};
	const suggestions = { faster: 0, slower: 0, unknown: 0 };
	let maxSendGapMs = 0;
	for (const summary of summaries) {
		endReasons[summary.endReason] = (endReasons[summary.endReason] ?? 0) + 1;
		maxSendGapMs = Math.max(maxSendGapMs, summary.maxSendGapMs);
		for (const { verdict } of summary.suggestions) {
			suggestions[verdict] += 1;
		}
	}
	return {
		accuracy: accuracyOf(summaries),
		date,
		endReasons,
		leave: leaveReportOf(summaries),
		maxSendGapMs,
		sessions: summaries.length,
		starts: countStarts(summaries),
		suggestions,
	};
}

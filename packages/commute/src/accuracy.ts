import { localParts } from "./calendar";
import type { CommutePlan, Leg, Route } from "./plan";
import type { LineRef, StopRef } from "./refs";
import { parseRef } from "./refs";
import type { LegEstimate } from "./session/estimate";
import type { EndReason, SessionInput, SessionState } from "./session/stage";
import type { ArrivalMethod, StopBoard, TransitBoards } from "./sources/types";

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
			/** 세션이 닫힌 시각과 이유. 요약의 `planId`, `endReason`이 여기서 나온다. */
			kind: "end";
			at: number;
			sessionId: string;
			planId: string;
			reason: EndReason;
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

export interface SessionSummary {
	endReason: EndReason;
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
	maxSendGapMs: number;
	sessions: number;
	/** `onTime`은 `startDelayMs`가 ±60초 안이다. */
	starts: { late: number; onTime: number; unknown: number };
	suggestions: { faster: number; slower: number; unknown: number };
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
		endReason: end?.reason ?? "user",
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
		maxSendGapMs,
		sessions: summaries.length,
		starts: countStarts(summaries),
		suggestions,
	};
}

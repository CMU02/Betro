import type { LineRef } from "./refs";

export const DEFAULT_TIMEZONE = "Asia/Seoul";
export const DEFAULT_LEAD_MINUTES = 10;

export interface CommuteConfig {
	/**
	 * 버스 도착정보 하루 예산 중 출퇴근 세션 몫. 지도 용도 호출은 `dailyBudgetBusArrival − 이 값`에
	 * 닿으면 부르지 않고 캐시만 쓴다(지도 설계 4.3).
	 */
	busArrivalSessionReserve: number;
	busNearPollMs: number;
	busNearWindowMs: number;
	busPollMs: number;
	dailyBudgetBusArrival: number;
	/**
	 * 지역 버스 오퍼레이션별 실행기 하루 예산(개발 계정 한도의 실행기 몫, 5-B 설계 결정 1). 위치 목록은
	 * 수집기와 나눠 쓰므로 실행기 몫만 둔다. 지도 용도 호출은 각 예산의 3분의 1을 세션 몫으로 남긴다.
	 */
	dailyBudgetGbisArrival: number;
	dailyBudgetGbisLocation: number;
	dailyBudgetTagoArrival: number;
	dailyBudgetTagoLocation: number;
	endGraceMs: number;
	heartbeatMs: number;
	leaveMarginByLine: Record<string, number>;
	leaveMarginMaxSec: number;
	leaveMarginSec: { bus: number; subway: number };
	leaveSlackHysteresisSec: number;
	maxSessionMs: number;
	staleAfterMs: number;
	subwayEtaBiasSec: Record<string, number>;
	suggestMinGainMs: number;
	tickMs: number;
	tokenWaitMs: number;
}

const DEFAULT_SUBWAY_ETA_BIAS_SEC: Record<string, number> = { line2: 60 };

// 사전 수집(스펙 4.3) 전 임시값. 차량 오차만 덮고 도보 오차는 덮지 않음
const DEFAULT_LEAVE_MARGIN_SEC = { bus: 180, subway: 120 } as const;

function numberFrom(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function biasFrom(value: string | undefined): Record<string, number> {
	if (value === undefined || value.trim() === "") {
		return { ...DEFAULT_SUBWAY_ETA_BIAS_SEC };
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { ...DEFAULT_SUBWAY_ETA_BIAS_SEC };
		}
		const result: Record<string, number> = {};
		for (const [key, entry] of Object.entries(parsed)) {
			if (typeof entry === "number" && Number.isFinite(entry)) {
				result[key] = entry;
			}
		}
		return result;
	} catch {
		return { ...DEFAULT_SUBWAY_ETA_BIAS_SEC };
	}
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function marginFrom(value: string | undefined): {
	bus: number;
	subway: number;
} {
	const fallback = { ...DEFAULT_LEAVE_MARGIN_SEC };
	if (value === undefined || value.trim() === "") {
		return fallback;
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed !== "object" || parsed === null) {
			return fallback;
		}
		const { bus, subway } = parsed as Record<string, unknown>;
		if (isNonNegativeNumber(bus) && isNonNegativeNumber(subway)) {
			return { bus, subway };
		}
		return fallback;
	} catch {
		return fallback;
	}
}

function marginByLineFrom(value: string | undefined): Record<string, number> {
	if (value === undefined || value.trim() === "") {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return {};
		}
		const result: Record<string, number> = {};
		for (const [key, entry] of Object.entries(parsed)) {
			if (isNonNegativeNumber(entry)) {
				result[key] = entry;
			}
		}
		return result;
	} catch {
		return {};
	}
}

// 노선 키가 수단 기본값보다 먼저. 방향 키는 1차 출시에서 찾지 않는다(스펙 4.3).
export function marginSecFor(
	config: CommuteConfig,
	mode: "bus" | "subway",
	line: LineRef
): number {
	const raw = config.leaveMarginByLine[line] ?? config.leaveMarginSec[mode];
	return Math.min(raw, config.leaveMarginMaxSec);
}

export function commuteConfig(
	env: Record<string, string | undefined>
): CommuteConfig {
	return {
		busArrivalSessionReserve: numberFrom(
			env.COMMUTE_BUS_ARRIVAL_SESSION_RESERVE,
			300
		),
		busNearPollMs: numberFrom(env.COMMUTE_BUS_NEAR_POLL_MS, 30_000),
		busNearWindowMs: numberFrom(env.COMMUTE_BUS_NEAR_WINDOW_MS, 360_000),
		busPollMs: numberFrom(env.COMMUTE_BUS_POLL_MS, 60_000),
		dailyBudgetBusArrival: numberFrom(
			env.COMMUTE_DAILY_BUDGET_BUS_ARRIVAL,
			900
		),
		dailyBudgetGbisArrival: numberFrom(env.DAILY_BUDGET_GBIS_ARRIVAL, 900),
		dailyBudgetGbisLocation: numberFrom(
			env.DAILY_BUDGET_GBIS_LOCATION_RUNNER,
			600
		),
		dailyBudgetTagoArrival: numberFrom(env.DAILY_BUDGET_TAGO_ARRIVAL, 9000),
		dailyBudgetTagoLocation: numberFrom(
			env.DAILY_BUDGET_TAGO_LOCATION_RUNNER,
			6000
		),
		endGraceMs: numberFrom(env.COMMUTE_END_GRACE_MS, 600_000),
		heartbeatMs: numberFrom(env.COMMUTE_HEARTBEAT_MS, 110_000),
		leaveMarginByLine: marginByLineFrom(env.COMMUTE_LEAVE_MARGIN_BY_LINE),
		leaveMarginMaxSec: numberFrom(env.COMMUTE_LEAVE_MARGIN_MAX_SEC, 300),
		leaveMarginSec: marginFrom(env.COMMUTE_LEAVE_MARGIN_SEC),
		leaveSlackHysteresisSec: numberFrom(
			env.COMMUTE_LEAVE_SLACK_HYSTERESIS_SEC,
			30
		),
		maxSessionMs: numberFrom(env.COMMUTE_MAX_SESSION_MS, 10_800_000),
		staleAfterMs: numberFrom(env.COMMUTE_STALE_AFTER_MS, 150_000),
		subwayEtaBiasSec: biasFrom(env.COMMUTE_SUBWAY_ETA_BIAS_SEC),
		suggestMinGainMs: numberFrom(env.COMMUTE_SUGGEST_MIN_GAIN_MS, 180_000),
		tickMs: numberFrom(env.COMMUTE_TICK_MS, 30_000),
		tokenWaitMs: numberFrom(env.COMMUTE_TOKEN_WAIT_MS, 60_000),
	};
}

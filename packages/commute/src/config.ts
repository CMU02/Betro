import type { LineRef } from "./refs";

export const DEFAULT_TIMEZONE = "Asia/Seoul";
export const DEFAULT_LEAD_MINUTES = 10;

export interface CommuteConfig {
	busNearPollMs: number;
	busNearWindowMs: number;
	busPollMs: number;
	dailyBudgetBusArrival: number;
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
		busNearPollMs: numberFrom(env.COMMUTE_BUS_NEAR_POLL_MS, 30_000),
		busNearWindowMs: numberFrom(env.COMMUTE_BUS_NEAR_WINDOW_MS, 360_000),
		busPollMs: numberFrom(env.COMMUTE_BUS_POLL_MS, 60_000),
		dailyBudgetBusArrival: numberFrom(
			env.COMMUTE_DAILY_BUDGET_BUS_ARRIVAL,
			900
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

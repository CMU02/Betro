export const DEFAULT_TIMEZONE = "Asia/Seoul";
export const DEFAULT_LEAD_MINUTES = 10;

export interface CommuteConfig {
	busNearPollMs: number;
	busNearWindowMs: number;
	busPollMs: number;
	dailyBudgetBusArrival: number;
	endGraceMs: number;
	heartbeatMs: number;
	maxSessionMs: number;
	staleAfterMs: number;
	subwayEtaBiasSec: Record<string, number>;
	suggestMinGainMs: number;
	tickMs: number;
	tokenWaitMs: number;
}

const DEFAULT_SUBWAY_ETA_BIAS_SEC: Record<string, number> = { line2: 60 };

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
		maxSessionMs: numberFrom(env.COMMUTE_MAX_SESSION_MS, 10_800_000),
		staleAfterMs: numberFrom(env.COMMUTE_STALE_AFTER_MS, 150_000),
		subwayEtaBiasSec: biasFrom(env.COMMUTE_SUBWAY_ETA_BIAS_SEC),
		suggestMinGainMs: numberFrom(env.COMMUTE_SUGGEST_MIN_GAIN_MS, 180_000),
		tickMs: numberFrom(env.COMMUTE_TICK_MS, 30_000),
		tokenWaitMs: numberFrom(env.COMMUTE_TOKEN_WAIT_MS, 60_000),
	};
}

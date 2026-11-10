import { LINES } from "@Betro/transit-static/lines";
import { type BudgetKind, type BudgetState, remaining } from "./budget";
import { isOperatingTime, kstDayStart, nextOperatingStart } from "./time";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const MIN_ALARM_DELAY_MS = 5000;
const HHMM = /^(\d{2}):(\d{2})$/;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;

const DEFAULT_OPERATING_START = "05:00";
const DEFAULT_OPERATING_END = "01:00";
const DEFAULT_DAILY_BUDGET = 900;
const DEV_SUBWAY_MIN_INTERVAL_MS = 80_000;
const DEV_BUS_MIN_INTERVAL_MS = 160_000;
const PROD_SUBWAY_MIN_INTERVAL_MS = 20_000;
const PROD_BUS_MIN_INTERVAL_MS = 30_000;
const PROD_BUS_REQUESTS_PER_SECOND = 10;
/** `dev` 버스 시험 노선: 6411, 150. */
export const DEV_BUS_ROUTE_IDS: readonly string[] = ["100100290", "100100029"];

export interface CollectorConfig {
	/** 버스 노선 하나의 최소 호출 간격. */
	busMinIntervalMs: number;
	/** `prod` 버스 초당 호출 상한(토큰 버킷). `dev`에는 없다. */
	busRequestsPerSecond?: number;
	busRouteIds: string[];
	dailyBudget: { subway: number; bus: number };
	mode: "dev" | "prod";
	operatingEnd: string;
	operatingStart: string;
	/** `prod` 위치 API 노선(`nameKo`). `dev`는 ALL 한 번이라 비어 있다. */
	subwayLines: string[];
	/** 지하철 소스 하나(dev: ALL, prod: 노선 하나)의 최소 호출 간격. */
	subwayMinIntervalMs: number;
}

export type EnvLike = Record<string, string | undefined>;

function readHhmm(env: EnvLike, name: string, fallback: string): string {
	const value = env[name] ?? fallback;
	const m = HHMM.exec(value);
	if (!(m && Number(m[1]) <= MAX_HOUR && Number(m[2]) <= MAX_MINUTE)) {
		throw new Error(`${name} must be HH:MM (KST)`);
	}
	return value;
}

function readCount(env: EnvLike, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw === "") {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return value;
}

function baseConfig(
	env: EnvLike
): Pick<CollectorConfig, "operatingStart" | "operatingEnd" | "dailyBudget"> {
	return {
		dailyBudget: {
			bus: readCount(env, "DAILY_BUDGET_BUS", DEFAULT_DAILY_BUDGET),
			subway: readCount(env, "DAILY_BUDGET_SUBWAY", DEFAULT_DAILY_BUDGET),
		},
		operatingEnd: readHhmm(env, "OPERATING_END_KST", DEFAULT_OPERATING_END),
		operatingStart: readHhmm(
			env,
			"OPERATING_START_KST",
			DEFAULT_OPERATING_START
		),
	};
}

/** 승인 전 한도: 지하철 ALL 1회로 전 노선, 버스 6411·150을 번갈아. */
export function devConfig(env: EnvLike): CollectorConfig {
	return {
		mode: "dev",
		...baseConfig(env),
		busMinIntervalMs: DEV_BUS_MIN_INTERVAL_MS,
		busRouteIds: [...DEV_BUS_ROUTE_IDS],
		subwayLines: [],
		subwayMinIntervalMs: DEV_SUBWAY_MIN_INTERVAL_MS,
	};
}

/** 승인 후: 19개 노선 위치 API, 주어진 버스 노선 전부. */
export function prodConfig(
	env: EnvLike,
	routeIds: readonly string[]
): CollectorConfig {
	return {
		mode: "prod",
		...baseConfig(env),
		busMinIntervalMs: PROD_BUS_MIN_INTERVAL_MS,
		busRequestsPerSecond: readCount(
			env,
			"BUS_REQUESTS_PER_SECOND",
			PROD_BUS_REQUESTS_PER_SECOND
		),
		busRouteIds: [...routeIds],
		subwayLines: LINES.map((line) => line.nameKo),
		subwayMinIntervalMs: PROD_SUBWAY_MIN_INTERVAL_MS,
	};
}

export type CallPlan =
	| { kind: "subway-all" }
	| { kind: "subway-position"; lineNameKo: string }
	| { kind: "bus"; routeId: string };

/** 소스별 다음 호출 시각. 키 `subway`, `subway:<lineNameKo>`, `bus:<routeId>`. */
export interface ScheduleState {
	nextAt: Record<string, number>;
}

export interface TickPlan {
	due: CallPlan[];
	nextAlarmAt: number;
	/** due 소스의 다음 시각을 반영한 새 스케줄. 다음 `planTick`에 그대로 넘긴다. */
	schedule: ScheduleState;
}

export function planKey(plan: CallPlan): string {
	switch (plan.kind) {
		case "subway-all":
			return "subway";
		case "subway-position":
			return `subway:${plan.lineNameKo}`;
		default:
			return `bus:${plan.routeId}`;
	}
}

function hhmmMs(s: string): number {
	const [h, m] = s.split(":").map(Number);
	return ((h as number) * 60 + (m as number)) * MINUTE_MS;
}

/** KST 하루 안의 운행 구간들(하루 시작 기준 ms, `[from, to)`). */
function operatingWindows(config: CollectorConfig): [number, number][] {
	const s = hhmmMs(config.operatingStart);
	const e = hhmmMs(config.operatingEnd);
	if (s === e) {
		return [[0, DAY_MS]];
	}
	return s < e
		? [[s, e]]
		: [
				[0, e],
				[s, DAY_MS],
			];
}

/** 지금부터 그 KST 날(00:00~24:00) 끝까지 남은 운행 시간. */
export function remainingOperatingMs(
	now: number,
	config: CollectorConfig
): number {
	const offset = now - kstDayStart(now);
	let total = 0;
	for (const [from, to] of operatingWindows(config)) {
		total += Math.max(0, to - Math.max(from, offset));
	}
	return total;
}

function sourcesFor(kind: BudgetKind, config: CollectorConfig): CallPlan[] {
	if (kind === "bus") {
		return config.busRouteIds.map((routeId) => ({ kind: "bus", routeId }));
	}
	if (config.mode === "dev") {
		return [{ kind: "subway-all" }];
	}
	return config.subwayLines.map((lineNameKo) => ({
		kind: "subway-position",
		lineNameKo,
	}));
}

/**
 * 소스 하나(지하철 ALL 또는 노선 하나, 버스 노선 하나)의 호출 간격.
 * 남은 예산을 같은 종류의 소스 수로 나눠 남은 운행 시간에 고르게 편다.
 */
export function interval(
	kind: BudgetKind,
	now: number,
	budget: BudgetState,
	config: CollectorConfig
): number {
	const minMs =
		kind === "bus" ? config.busMinIntervalMs : config.subwayMinIntervalMs;
	const sources = Math.max(1, sourcesFor(kind, config).length);
	const left = Math.max(1, remaining(budget, kind, config, now));
	return Math.max(minMs, (remainingOperatingMs(now, config) * sources) / left);
}

interface KindPlan {
	due: CallPlan[];
	wakeAt: number;
}

function planKind(
	kind: BudgetKind,
	now: number,
	nextAt: Record<string, number>,
	budget: BudgetState,
	config: CollectorConfig
): KindPlan {
	const sources = sourcesFor(kind, config);
	if (sources.length === 0) {
		return { due: [], wakeAt: Number.POSITIVE_INFINITY };
	}
	const left = remaining(budget, kind, config, now);
	if (left <= 0) {
		return { due: [], wakeAt: kstDayStart(now) + DAY_MS };
	}
	const every = interval(kind, now, budget, config);
	const when = (plan: CallPlan): number =>
		nextAt[planKey(plan)] ?? Number.NEGATIVE_INFINITY;
	const overdue = sources
		.filter((plan) => when(plan) <= now)
		.sort((a, b) => when(a) - when(b));
	// dev 버스는 한 번에 한 노선씩 번갈아 부른다.
	const limit = kind === "bus" && config.mode === "dev" ? 1 : left;
	const due = overdue.slice(0, limit);
	for (const plan of due) {
		nextAt[planKey(plan)] = now + every;
	}
	const slot = every / sources.length;
	for (const [i, plan] of overdue.slice(limit).entries()) {
		nextAt[planKey(plan)] = now + slot * (i + 1);
	}
	const wakeAt = Math.min(...sources.map(when));
	return { due, wakeAt };
}

/**
 * 지금 부를 소스와 다음 alarm 시각.
 * 운행 시간 밖이면 다음 운행 시작까지 잔다. 예산이 0인 소스는 KST 0시까지 쉰다.
 */
export function planTick(
	now: number,
	schedule: ScheduleState,
	budget: BudgetState,
	config: CollectorConfig
): TickPlan {
	if (!isOperatingTime(now, config.operatingStart, config.operatingEnd)) {
		return {
			due: [],
			nextAlarmAt: nextOperatingStart(now, config.operatingStart),
			schedule,
		};
	}
	const nextAt = { ...schedule.nextAt };
	const subway = planKind("subway", now, nextAt, budget, config);
	const bus = planKind("bus", now, nextAt, budget, config);
	const wakeAt = Math.min(subway.wakeAt, bus.wakeAt);
	const nextAlarmAt = Number.isFinite(wakeAt)
		? Math.max(now + MIN_ALARM_DELAY_MS, wakeAt)
		: nextOperatingStart(now, config.operatingStart);
	return {
		due: [...subway.due, ...bus.due],
		nextAlarmAt,
		schedule: { nextAt },
	};
}

/** `prod` 버스 초당 호출 상한용 토큰 버킷. 용량은 초당 건수와 같다. */
export interface TokenBucket {
	tokens: number;
	updatedAt: number;
}

export function takeToken(
	bucket: TokenBucket,
	now: number,
	ratePerSecond: number
): { ok: boolean; bucket: TokenBucket; waitMs: number } {
	const elapsed = Math.max(0, now - bucket.updatedAt);
	const tokens = Math.min(
		ratePerSecond,
		bucket.tokens + (elapsed * ratePerSecond) / 1000
	);
	if (tokens >= 1) {
		return {
			bucket: { tokens: tokens - 1, updatedAt: now },
			ok: true,
			waitMs: 0,
		};
	}
	return {
		bucket: { tokens, updatedAt: now },
		ok: false,
		waitMs: Math.ceil(((1 - tokens) * 1000) / ratePerSecond),
	};
}

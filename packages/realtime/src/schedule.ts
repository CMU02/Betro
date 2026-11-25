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
/** 수집기 몫의 GBIS·TAGO 위치 목록 하루 예산(개발 계정, 5-B 설계 결정 1). */
const DEFAULT_DAILY_BUDGET_GBIS_POSITION = 300;
const DEFAULT_DAILY_BUDGET_TAGO_POSITION = 3000;
/** 출처를 붙인 지역 노선 키(`gbis:<routeId>`, `tago:<routeId>`). */
const REGIONAL_ROUTE_KEY = /^(gbis|tago):(.+)$/;
/** 지역 위치 목록 간격 상한. 하한(dev 160초)보다 크고 차량 TTL(300초)보다 작다. */
const DEFAULT_REGIONAL_MAX_INTERVAL_MS = 240_000;
const DEFAULT_MAP_WATCH_MAX_PER_INSTALL = 6;
const DEFAULT_MAP_WATCH_MAX_TOTAL = 40;
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
	/** 서울 노선 ID(맨 ID). 지역 노선은 관측 요청(`extraBusRouteIds`)으로만 들어온다. */
	busRouteIds: string[];
	dailyBudget: {
		bus: number;
		/** 수집기 몫의 GBIS 위치 목록(`getBusLocationListv2`). */
		gbisPosition: number;
		subway: number;
		/** 수집기 몫의 TAGO 위치 목록(`getRouteAcctoBusLcList`). */
		tagoPosition: number;
	};
	/** 설치 하나가 동시에 관측을 요청할 수 있는 버스 노선 수. */
	mapWatchMaxPerInstall: number;
	/** 모든 설치의 관측 요청을 합쳐 실제로 부르는 버스 노선 수 상한. */
	mapWatchMaxTotal: number;
	mode: "dev" | "prod";
	operatingEnd: string;
	operatingStart: string;
	/**
	 * 지역 위치 목록(GBIS·TAGO) 호출 간격 상한. 예산을 운행 시간 전체에 펴면 간격이 차량 TTL을
	 * 넘으므로 여기서 자른다. 하한(`busMinIntervalMs`)이 더 크면 하한이 이긴다.
	 */
	regionalMaxIntervalMs: number;
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
): Pick<
	CollectorConfig,
	| "operatingStart"
	| "operatingEnd"
	| "dailyBudget"
	| "mapWatchMaxPerInstall"
	| "mapWatchMaxTotal"
	| "regionalMaxIntervalMs"
> {
	return {
		dailyBudget: {
			bus: readCount(env, "DAILY_BUDGET_BUS", DEFAULT_DAILY_BUDGET),
			gbisPosition: readCount(
				env,
				"DAILY_BUDGET_GBIS_LOCATION_COLLECTOR",
				DEFAULT_DAILY_BUDGET_GBIS_POSITION
			),
			subway: readCount(env, "DAILY_BUDGET_SUBWAY", DEFAULT_DAILY_BUDGET),
			tagoPosition: readCount(
				env,
				"DAILY_BUDGET_TAGO_LOCATION_COLLECTOR",
				DEFAULT_DAILY_BUDGET_TAGO_POSITION
			),
		},
		mapWatchMaxPerInstall: readCount(
			env,
			"MAP_WATCH_MAX_PER_INSTALL",
			DEFAULT_MAP_WATCH_MAX_PER_INSTALL
		),
		mapWatchMaxTotal: readCount(
			env,
			"MAP_WATCH_MAX_TOTAL",
			DEFAULT_MAP_WATCH_MAX_TOTAL
		),
		operatingEnd: readHhmm(env, "OPERATING_END_KST", DEFAULT_OPERATING_END),
		operatingStart: readHhmm(
			env,
			"OPERATING_START_KST",
			DEFAULT_OPERATING_START
		),
		regionalMaxIntervalMs: readCount(
			env,
			"REGIONAL_MAX_INTERVAL_MS",
			DEFAULT_REGIONAL_MAX_INTERVAL_MS
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

export type RegionalSource = "gbis" | "tago";

export type CallPlan =
	| { kind: "subway-all" }
	| { kind: "subway-position"; lineNameKo: string }
	| { kind: "bus"; routeId: string }
	/**
	 * GBIS·TAGO 위치 목록. `routeId`는 맨 노선 ID다. `cityCode`(TAGO 도시 코드)는 스케줄이
	 * 모르므로 null로 내고, 수집기가 부르기 전에 참조에서 채운다.
	 */
	| {
			kind: "regional-bus";
			source: RegionalSource;
			routeId: string;
			cityCode: string | null;
	  };

/**
 * 소스별 다음 호출 시각. 키 `subway`, `subway:<lineNameKo>`, `bus:<routeId>`,
 * `bus:gbis:<routeId>`, `bus:tago:<routeId>`.
 */
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
		case "regional-bus":
			return `bus:${plan.source}:${plan.routeId}`;
		default:
			return `bus:${plan.routeId}`;
	}
}

/** 지역 노선 키(`gbis:…`, `tago:…`)의 출처와 맨 노선 ID. 서울 노선(맨 ID)이면 null. */
export function parseRegionalRouteKey(
	key: string
): { source: RegionalSource; routeId: string } | null {
	const m = REGIONAL_ROUTE_KEY.exec(key);
	if (!(m?.[1] && m[2])) {
		return null;
	}
	return { routeId: m[2], source: m[1] as RegionalSource };
}

/** 지역 버스 호출의 예산 종류. */
export function regionalBudgetKind(source: RegionalSource): BudgetKind {
	return source === "gbis" ? "gbis-position" : "tago-position";
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

/** 서울 버스 소스 노선: 관측 요청 노선을 먼저, 그 뒤에 설정 노선(중복 제거, 지역 키는 뺀다). */
function busRoutesFor(
	config: CollectorConfig,
	extraBusRouteIds: readonly string[]
): string[] {
	return [...new Set([...extraBusRouteIds, ...config.busRouteIds])].filter(
		(routeId) => parseRegionalRouteKey(routeId) === null
	);
}

/** 지역 버스 소스: 관측 요청 노선 중 그 출처의 키만(중복 제거). */
function regionalSourcesFor(
	source: RegionalSource,
	extraBusRouteIds: readonly string[]
): CallPlan[] {
	const plans: CallPlan[] = [];
	for (const key of new Set(extraBusRouteIds)) {
		const parsed = parseRegionalRouteKey(key);
		if (parsed?.source === source) {
			plans.push({
				cityCode: null,
				kind: "regional-bus",
				routeId: parsed.routeId,
				source,
			});
		}
	}
	return plans;
}

function sourcesFor(
	kind: BudgetKind,
	config: CollectorConfig,
	extraBusRouteIds: readonly string[]
): CallPlan[] {
	if (kind === "bus") {
		return busRoutesFor(config, extraBusRouteIds).map((routeId) => ({
			kind: "bus",
			routeId,
		}));
	}
	if (kind === "gbis-position") {
		return regionalSourcesFor("gbis", extraBusRouteIds);
	}
	if (kind === "tago-position") {
		return regionalSourcesFor("tago", extraBusRouteIds);
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
 * 남은 예산을 같은 종류의 소스 수(버스는 관측 요청 노선까지 합친 수)로 나눠
 * 남은 운행 시간에 고르게 편다.
 */
export function interval(
	kind: BudgetKind,
	now: number,
	budget: BudgetState,
	config: CollectorConfig,
	extraBusRouteIds: readonly string[] = []
): number {
	const minMs =
		kind === "subway" ? config.subwayMinIntervalMs : config.busMinIntervalMs;
	const sources = Math.max(
		1,
		sourcesFor(kind, config, extraBusRouteIds).length
	);
	const left = Math.max(1, remaining(budget, kind, config, now));
	const spread = Math.max(
		minMs,
		(remainingOperatingMs(now, config) * sources) / left
	);
	if (kind === "gbis-position" || kind === "tago-position") {
		// 지역 노선은 간격이 차량 TTL을 넘지 않게 자른다. 하한이 더 크면 하한이 이긴다.
		return Math.min(spread, Math.max(minMs, config.regionalMaxIntervalMs));
	}
	return spread;
}

/** 버스 소스 종류. 서울 버스와 지역 출처마다 예산·간격을 따로 편다(5-B 설계 결정 3). */
const BUS_KINDS: readonly BudgetKind[] = [
	"bus",
	"gbis-position",
	"tago-position",
];

interface KindPlan {
	due: CallPlan[];
	wakeAt: number;
}

/**
 * 이제 부르지 않는 버스 노선(관측 요청이 끝난 노선)의 지난 시각을 지운다. 지난 시각은 없는 것과
 * 같으므로 동작은 그대로이고, 요청이 오갈 때마다 스케줄이 커지지 않게 한다. `sources`는 서울과
 * 지역 버스 소스를 모두 담는다(키가 모두 `bus:`로 시작한다).
 */
function forgetStaleBusKeys(
	nextAt: Record<string, number>,
	sources: readonly CallPlan[],
	now: number
): void {
	const live = new Set(sources.map(planKey));
	for (const [key, at] of Object.entries(nextAt)) {
		if (key.startsWith("bus:") && !live.has(key) && at <= now) {
			delete nextAt[key];
		}
	}
}

function planKind(
	kind: BudgetKind,
	now: number,
	nextAt: Record<string, number>,
	budget: BudgetState,
	config: CollectorConfig,
	extraBusRouteIds: readonly string[]
): KindPlan {
	const sources = sourcesFor(kind, config, extraBusRouteIds);
	if (sources.length === 0) {
		return { due: [], wakeAt: Number.POSITIVE_INFINITY };
	}
	const left = remaining(budget, kind, config, now);
	if (left <= 0) {
		return { due: [], wakeAt: kstDayStart(now) + DAY_MS };
	}
	const every = interval(kind, now, budget, config, extraBusRouteIds);
	const when = (plan: CallPlan): number =>
		nextAt[planKey(plan)] ?? Number.NEGATIVE_INFINITY;
	// 관측 요청 노선이 설정 노선(시험 노선, 지도용 상시 관측)보다 먼저다(지도 설계 4.3).
	const extras = new Set(extraBusRouteIds);
	const rank = (plan: CallPlan): number =>
		plan.kind === "bus" && !extras.has(plan.routeId) ? 1 : 0;
	const overdue = sources
		.filter((plan) => when(plan) <= now)
		.sort((a, b) => rank(a) - rank(b) || when(a) - when(b));
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
 * `extraBusRouteIds`는 지도 관측 요청 노선이다. 설정 노선보다 먼저 두고 같은 예산을 나눠 쓴다.
 */
export function planTick(
	now: number,
	schedule: ScheduleState,
	budget: BudgetState,
	config: CollectorConfig,
	extraBusRouteIds: readonly string[] = []
): TickPlan {
	if (!isOperatingTime(now, config.operatingStart, config.operatingEnd)) {
		return {
			due: [],
			nextAlarmAt: nextOperatingStart(now, config.operatingStart),
			schedule,
		};
	}
	const nextAt = { ...schedule.nextAt };
	forgetStaleBusKeys(
		nextAt,
		BUS_KINDS.flatMap((kind) => sourcesFor(kind, config, extraBusRouteIds)),
		now
	);
	const subway = planKind("subway", now, nextAt, budget, config, []);
	const buses = BUS_KINDS.map((kind) =>
		planKind(kind, now, nextAt, budget, config, extraBusRouteIds)
	);
	const wakeAt = Math.min(subway.wakeAt, ...buses.map((plan) => plan.wakeAt));
	const nextAlarmAt = Number.isFinite(wakeAt)
		? Math.max(now + MIN_ALARM_DELAY_MS, wakeAt)
		: nextOperatingStart(now, config.operatingStart);
	return {
		due: [...subway.due, ...buses.flatMap((plan) => plan.due)],
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

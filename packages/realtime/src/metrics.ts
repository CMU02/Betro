import { isLineKey, LINES } from "@Betro/transit-static/lines";
import {
	TRAIN_NO_RULES,
	trainNoCandidates,
} from "@Betro/transit-static/realtime/train-no-rules";
import type { BudgetKind, BudgetState } from "./budget";
import { remaining } from "./budget";
import type { HistorySummary } from "./history";
import type { BusObservation, SubwayObservation } from "./observation";
import type { CollectorConfig } from "./schedule";
import {
	isOperatingTime,
	kstParts,
	kstToEpochMs,
	nextOperatingStart,
} from "./time";
import type { UpstreamOutcome } from "./upstream/classify";

/** 마지막 성공에서 이만큼 지나면 "지연". */
export const DELAYED_AFTER_MS = 300_000;
/** 마지막 성공에서 이만큼 지나면 "멈춤". */
export const STALLED_AFTER_MS = 900_000;
/** 5분 지표를 DO SQLite에 두는 기간. */
export const METRICS_RETENTION_DAYS = 7;
/** 지표 버킷 길이. KST 오프셋(9시간)이 5분의 배수라 UTC로 잘라도 KST 5분 칸과 같다. */
export const METRICS_BUCKET_MS = 300_000;
/** 버킷이 이만큼 이어서 비면 일일 보고서에서 멈춘 구간으로 본다(15분). */
export const STALLED_GAP_BUCKETS = 3;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const OPERATING_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^(\d{1,2}):(\d{2})$/;

/** 지표·상태를 따로 보는 소스. 예산 단위와 같다. */
export type MetricsSource = BudgetKind;
const SOURCES: readonly MetricsSource[] = ["subway", "bus"];

/** 상류가 응답을 돌려준 결과. 차량이 없다는 응답(`no-data`, `service-ended`)도 수집은 된 것으로 본다. */
const RESPONDED_OUTCOMES: ReadonlySet<UpstreamOutcome> = new Set([
	"ok",
	"no-data",
	"service-ended",
]);

/** 수집이 이어지고 있다고 볼 결과. `lastSuccessAt`과 일일 보고서 빈칸 판정이 같은 기준을 쓴다. */
export function isSuccessfulOutcome(outcome: UpstreamOutcome): boolean {
	return RESPONDED_OUTCOMES.has(outcome);
}

/**
 * 5분 단위 지표 한 칸(소스별). 노선별 키는 지하철 lineKey, 버스 routeId.
 *
 * - `calls`: 시도 수(재시도 포함). `errors`: `ok`가 아닌 결과별 수.
 * - `maxFreshnessMs`: 호출마다 (받은 시각 − 응답 안 가장 늦은 원천 시각)의 최댓값.
 * - `vehicles`: 노선별 차량 수. 칸 안의 여러 호출 중 최댓값(지하철은 위치를 아는 열차만).
 * - `matched`/`observed`: 열차번호 규칙이 있는 노선의 관측 수 합(매칭률 = 합/합).
 * - `backwards`: 역행 버스 관측 수 합. `unknownStations`: 역을 찾지 못한 지하철 관측 수 합.
 */
export interface MetricsBucket {
	backwards: number;
	bucketStart: number;
	calls: number;
	errors: Partial<Record<UpstreamOutcome, number>>;
	matched: Record<string, number>;
	maxFreshnessMs: number | null;
	observed: Record<string, number>;
	source: MetricsSource;
	unknownStations: number;
	vehicles: Record<string, number>;
}

export type AnyObservation = SubwayObservation | BusObservation;

/** 노선(지하철 lineKey 또는 버스 routeId) 하나의 지금 관측 집계. */
export interface LineCounts {
	backwards: number;
	matched: number;
	observed: number;
	unknownStations: number;
	vehicles: number;
}

export function bucketStartOf(at: number): number {
	return Math.floor(at / METRICS_BUCKET_MS) * METRICS_BUCKET_MS;
}

function isBus(obs: AnyObservation): obs is BusObservation {
	return "vehId" in obs;
}

function emptyCounts(): LineCounts {
	return {
		backwards: 0,
		matched: 0,
		observed: 0,
		unknownStations: 0,
		vehicles: 0,
	};
}

function hasTrainNoRule(key: string): boolean {
	return isLineKey(key) && TRAIN_NO_RULES[key] !== null;
}

function addSubway(counts: LineCounts, obs: SubwayObservation): void {
	// 위치를 정하지 못한 열차(ALL에 99 행만 있어 `position-unknown`, status null)는 세지 않는다.
	// dev 모드는 ALL 하나만 받아서, 위치 API라면 보이지 않았을 열차(도착 정보에만 있는 열차)를
	// 따로 가려낼 수 없다. 그래서 상태가 있는 열차만 센다.
	if (obs.status !== null) {
		counts.vehicles += 1;
	}
	if (trainNoCandidates(obs.lineKey, obs.rawTrainNo) !== null) {
		counts.observed += 1;
		if (obs.matchStatus === "matched") {
			counts.matched += 1;
		}
	}
	if (obs.qualityFlags.includes("unknown-station")) {
		counts.unknownStations += 1;
	}
}

function addBus(counts: LineCounts, obs: BusObservation): void {
	counts.vehicles += 1;
	if (obs.qualityFlags.includes("backwards")) {
		counts.backwards += 1;
	}
}

/**
 * 관측을 노선별로 센다. 상태 페이지에는 최신 상태(`LatestState` 스냅샷)의 차량을 넣고,
 * 지표에는 호출 한 번의 관측을 넣는다.
 */
export function countByLine(
	observations: readonly AnyObservation[]
): Record<string, LineCounts> {
	const out: Record<string, LineCounts> = {};
	for (const obs of observations) {
		const key = isBus(obs) ? obs.routeId : obs.lineKey;
		const counts = out[key] ?? emptyCounts();
		out[key] = counts;
		if (isBus(obs)) {
			addBus(counts, obs);
		} else {
			addSubway(counts, obs);
		}
	}
	return out;
}

function latestSourceAt(
	observations: readonly AnyObservation[]
): number | null {
	let latest: number | null = null;
	for (const obs of observations) {
		if (obs.sourceAt !== null && (latest === null || obs.sourceAt > latest)) {
			latest = obs.sourceAt;
		}
	}
	return latest;
}

function emptyBucket(
	bucketStart: number,
	source: MetricsSource
): MetricsBucket {
	return {
		backwards: 0,
		bucketStart,
		calls: 0,
		errors: {},
		matched: {},
		maxFreshnessMs: null,
		observed: {},
		source,
		unknownStations: 0,
		vehicles: {},
	};
}

/**
 * 호출 한 번을 5분 지표에 더한다. `bucket`이 같은 칸·같은 소스가 아니면 새 칸을 만든다.
 * 넘긴 버킷은 바꾸지 않는다.
 */
export function recordCall(
	bucket: MetricsBucket | undefined,
	now: number,
	source: MetricsSource,
	outcome: UpstreamOutcome,
	observations: readonly AnyObservation[]
): MetricsBucket {
	const start = bucketStartOf(now);
	const base =
		bucket && bucket.bucketStart === start && bucket.source === source
			? bucket
			: emptyBucket(start, source);
	const next: MetricsBucket = {
		...base,
		calls: base.calls + 1,
		errors: { ...base.errors },
		matched: { ...base.matched },
		observed: { ...base.observed },
		vehicles: { ...base.vehicles },
	};
	if (outcome !== "ok") {
		next.errors[outcome] = (next.errors[outcome] ?? 0) + 1;
	}
	const latest = latestSourceAt(observations);
	if (latest !== null) {
		const freshness = Math.max(0, now - latest);
		next.maxFreshnessMs = Math.max(next.maxFreshnessMs ?? 0, freshness);
	}
	for (const [key, counts] of Object.entries(countByLine(observations))) {
		next.vehicles[key] = Math.max(next.vehicles[key] ?? 0, counts.vehicles);
		if (hasTrainNoRule(key) && counts.observed > 0) {
			next.matched[key] = (next.matched[key] ?? 0) + counts.matched;
			next.observed[key] = (next.observed[key] ?? 0) + counts.observed;
		}
		next.backwards += counts.backwards;
		next.unknownStations += counts.unknownStations;
	}
	return next;
}

export type CollectorHealth = "ok" | "delayed" | "stalled" | "off-hours";

export interface HealthThresholds {
	delayedAfterMs: number;
	stalledAfterMs: number;
}

const DEFAULT_THRESHOLDS: HealthThresholds = {
	delayedAfterMs: DELAYED_AFTER_MS,
	stalledAfterMs: STALLED_AFTER_MS,
};

/**
 * 소스 상태. 마지막 성공이 지금 운행 구간 시작보다 이르거나 없으면 운행 시작 시각부터 잰다
 * (05:00 직후 첫 호출 전에 어제 성공 시각 때문에 "멈춤"이 되지 않게).
 */
export function sourceHealth(
	lastSuccessAt: number | null,
	now: number,
	config: CollectorConfig,
	thresholds: HealthThresholds = DEFAULT_THRESHOLDS
): CollectorHealth {
	if (!isOperatingTime(now, config.operatingStart, config.operatingEnd)) {
		return "off-hours";
	}
	const operatingSince =
		nextOperatingStart(now, config.operatingStart) - DAY_MS;
	const since = Math.max(lastSuccessAt ?? operatingSince, operatingSince);
	const age = now - since;
	if (age > thresholds.stalledAfterMs) {
		return "stalled";
	}
	return age > thresholds.delayedAfterMs ? "delayed" : "ok";
}

const HEALTH_RANK: Readonly<Record<CollectorHealth, number>> = {
	delayed: 2,
	"off-hours": 0,
	ok: 1,
	stalled: 3,
};

function worstHealth(values: readonly CollectorHealth[]): CollectorHealth {
	let worst: CollectorHealth = "off-hours";
	for (const value of values) {
		if (HEALTH_RANK[value] > HEALTH_RANK[worst]) {
			worst = value;
		}
	}
	return worst;
}

export interface SourceStatus {
	errorsToday: Partial<Record<UpstreamOutcome, number>>;
	freshnessMs: number | null;
	health: CollectorHealth;
	lastSuccessAt: number | null;
	name: MetricsSource;
	remainingToday: number;
	usedToday: number;
}

export interface LineStatus {
	backwards: number;
	/** 지금 차량 수 / 지난 7일 같은 5분 칸 평균. 비교할 값이 없거나 평균이 0이면 null. */
	baselineRatio: number | null;
	key: string;
	/** 열차번호 규칙이 없는 노선(신분당, GTX-A)과 버스, 관측이 없을 때는 null. */
	matchRate: number | null;
	unknownStations: number;
	vehicles: number;
}

export interface CollectorStatus {
	generatedAt: number;
	lines: LineStatus[];
	mode: CollectorConfig["mode"];
	overall: CollectorHealth;
	/** 지난 24시간 5분 지표(시각, 소스 순). */
	series: MetricsBucket[];
	sources: SourceStatus[];
}

/** 소스 하나에 대해 `CollectorCore`가 들고 있는 값. */
export interface SourceProgress {
	/** 오늘(KST) 결과별 오류 수. */
	errorsToday: Partial<Record<UpstreamOutcome, number>>;
	/** 마지막으로 받은 응답의 가장 늦은 원천 시각. */
	lastSourceAt: number | null;
	/** 마지막으로 `isSuccessfulOutcome`인 응답을 받은 시각. */
	lastSuccessAt: number | null;
}

export interface StatusInput {
	budget: BudgetState;
	config: CollectorConfig;
	/** 최신 상태 차량을 `countByLine`으로 센 값. */
	lineCounts: Readonly<Record<string, LineCounts>>;
	now: number;
	/** 지난 `METRICS_RETENTION_DAYS`일 5분 지표. */
	recentBuckets: readonly MetricsBucket[];
	sources: Readonly<Record<MetricsSource, SourceProgress>>;
	thresholds?: HealthThresholds;
}

function activeSources(config: CollectorConfig): MetricsSource[] {
	return SOURCES.filter(
		(source) => source === "subway" || config.busRouteIds.length > 0
	);
}

function sourceOfLine(key: string): MetricsSource {
	return isLineKey(key) ? "subway" : "bus";
}

/** 지하철 노선(LINES 순), 설정의 버스 노선, 그 밖에 보인 키(이름 순). */
function orderedLineKeys(
	config: CollectorConfig,
	seen: Iterable<string>
): string[] {
	const keys: string[] = [
		...LINES.map((line) => line.lineKey),
		...config.busRouteIds,
	];
	const known = new Set(keys);
	// 키는 ASCII ID라 코드 단위 순서로 둔다(로캘에 따라 달라지지 않게). Set이라 같은 값은 없다.
	const extra = [...new Set(seen)]
		.filter((key) => !known.has(key))
		.sort((a, b) => (a < b ? -1 : 1));
	return [...keys, ...extra];
}

function bucketIndex(
	buckets: readonly MetricsBucket[]
): Map<string, MetricsBucket> {
	const index = new Map<string, MetricsBucket>();
	for (const bucket of buckets) {
		index.set(`${bucket.source}|${bucket.bucketStart}`, bucket);
	}
	return index;
}

function baselineRatio(
	key: string,
	vehicles: number,
	now: number,
	index: ReadonlyMap<string, MetricsBucket>
): number | null {
	const source = sourceOfLine(key);
	const slot = bucketStartOf(now);
	const past: number[] = [];
	for (let day = 1; day <= METRICS_RETENTION_DAYS; day += 1) {
		const value = index.get(`${source}|${slot - day * DAY_MS}`)?.vehicles[key];
		if (value !== undefined) {
			past.push(value);
		}
	}
	if (past.length === 0) {
		return null;
	}
	const average = past.reduce((sum, v) => sum + v, 0) / past.length;
	return average > 0 ? vehicles / average : null;
}

function rate(matched: number, observed: number): number | null {
	return observed > 0 ? matched / observed : null;
}

function byTimeThenSource(a: MetricsBucket, b: MetricsBucket): number {
	return a.bucketStart - b.bucketStart || a.source.localeCompare(b.source);
}

/** 상태 페이지·`/status.json` 본문. */
export function buildStatus(input: StatusInput): CollectorStatus {
	const { budget, config, lineCounts, now, recentBuckets } = input;
	const today = kstParts(now).date;
	const sources = activeSources(config).map((name): SourceStatus => {
		const progress = input.sources[name];
		return {
			errorsToday: { ...progress.errorsToday },
			freshnessMs:
				progress.lastSourceAt === null
					? null
					: Math.max(0, now - progress.lastSourceAt),
			health: sourceHealth(
				progress.lastSuccessAt,
				now,
				config,
				input.thresholds
			),
			lastSuccessAt: progress.lastSuccessAt,
			name,
			remainingToday: remaining(budget, name, config, now),
			usedToday: budget.kstDay === today ? budget.used[name] : 0,
		};
	});
	const index = bucketIndex(recentBuckets);
	const lines = orderedLineKeys(config, Object.keys(lineCounts)).map(
		(key): LineStatus => {
			const counts = lineCounts[key] ?? emptyCounts();
			return {
				backwards: counts.backwards,
				baselineRatio: baselineRatio(key, counts.vehicles, now, index),
				key,
				matchRate: hasTrainNoRule(key)
					? rate(counts.matched, counts.observed)
					: null,
				unknownStations: counts.unknownStations,
				vehicles: counts.vehicles,
			};
		}
	);
	const series = recentBuckets
		.filter((b) => b.bucketStart > now - DAY_MS && b.bucketStart <= now)
		.sort(byTimeThenSource);
	return {
		generatedAt: now,
		lines,
		mode: config.mode,
		overall: worstHealth(sources.map((s) => s.health)),
		series,
		sources,
	};
}

export interface StalledInterval {
	/** 첫 빈 칸 시작. */
	from: number;
	source: MetricsSource;
	/** 마지막 빈 칸 끝(미포함). */
	to: number;
}

export interface DailyReport {
	calls: Partial<Record<MetricsSource, number>>;
	errors: Partial<
		Record<MetricsSource, Partial<Record<UpstreamOutcome, number>>>
	>;
	/**
	 * 버퍼에 넣은 이력 줄 수와 R2에 쓴 줄 수. 지표는 저장됐는데 이력만 사라진 경우를 잡는다.
	 * 세지 못한 날은 null.
	 */
	history: HistorySummary | null;
	lines: {
		key: string;
		avgVehicles: number | null;
		matchRate: number | null;
	}[];
	/**
	 * 멈춘 구간이 없고, 소스별 호출 수가 KST 날짜마다 하루 예산 이하이고,
	 * 버퍼에 넣은 이력 줄이 모두 R2에 쓰였다.
	 */
	ok: boolean;
	operatingDate: string;
	stalledIntervals: StalledInterval[];
	/** 보고서가 다룬 운행 시간 `[from, to)`. */
	window: { from: number; to: number };
}

function hhmmMs(s: string): number {
	const m = HHMM.exec(s);
	if (!m) {
		throw new Error(`Invalid HH:MM: ${s}`);
	}
	return (Number(m[1]) * 60 + Number(m[2])) * MINUTE_MS;
}

/** 운행일 D의 운행 시간: D 시작 시각부터 끝 시각(시작보다 이르면 D+1)까지. */
export function operatingWindow(
	operatingDate: string,
	config: CollectorConfig
): { from: number; to: number } {
	if (!OPERATING_DATE.test(operatingDate)) {
		throw new Error(`operatingDate must be YYYY-MM-DD: ${operatingDate}`);
	}
	const dayStart = kstToEpochMs(`${operatingDate} 00:00:00`);
	const start = hhmmMs(config.operatingStart);
	const end = hhmmMs(config.operatingEnd);
	const from = dayStart + start;
	return { from, to: end > start ? dayStart + end : dayStart + DAY_MS + end };
}

function respondedCalls(bucket: MetricsBucket): number {
	let failed = 0;
	for (const [outcome, count] of Object.entries(bucket.errors)) {
		if (!isSuccessfulOutcome(outcome as UpstreamOutcome)) {
			failed += count ?? 0;
		}
	}
	return bucket.calls - failed;
}

/** 응답을 받은 버킷이 없는 5분 칸이 `STALLED_GAP_BUCKETS`칸 이상 이어진 구간. */
function stalledIntervalsOf(
	source: MetricsSource,
	window: { from: number; to: number },
	index: ReadonlyMap<string, MetricsBucket>
): StalledInterval[] {
	const out: StalledInterval[] = [];
	let runStart: number | null = null;
	let runLength = 0;
	const closeRun = (end: number): void => {
		if (runStart !== null && runLength >= STALLED_GAP_BUCKETS) {
			out.push({ from: runStart, source, to: end });
		}
		runStart = null;
		runLength = 0;
	};
	for (let slot = window.from; slot < window.to; slot += METRICS_BUCKET_MS) {
		const bucket = index.get(`${source}|${slot}`);
		if (bucket && respondedCalls(bucket) > 0) {
			closeRun(slot);
			continue;
		}
		runStart ??= slot;
		runLength += 1;
	}
	closeRun(window.to);
	return out;
}

function withinBudget(
	source: MetricsSource,
	buckets: readonly MetricsBucket[],
	config: CollectorConfig
): boolean {
	// 예산은 KST 0시에 초기화되므로 운행일을 KST 날짜로 나눠 각각 비교한다.
	const byDay = new Map<string, number>();
	for (const bucket of buckets) {
		if (bucket.source === source) {
			const day = kstParts(bucket.bucketStart).date;
			byDay.set(day, (byDay.get(day) ?? 0) + bucket.calls);
		}
	}
	return [...byDay.values()].every(
		(calls) => calls <= config.dailyBudget[source]
	);
}

function addErrors(
	into: Partial<Record<UpstreamOutcome, number>>,
	from: Partial<Record<UpstreamOutcome, number>>
): void {
	for (const [outcome, count] of Object.entries(from)) {
		const key = outcome as UpstreamOutcome;
		into[key] = (into[key] ?? 0) + (count ?? 0);
	}
}

function reportLines(
	buckets: readonly MetricsBucket[],
	config: CollectorConfig
): DailyReport["lines"] {
	const vehicleSum = new Map<string, { total: number; n: number }>();
	const matched = new Map<string, number>();
	const observed = new Map<string, number>();
	for (const bucket of buckets) {
		for (const [key, count] of Object.entries(bucket.vehicles)) {
			const acc = vehicleSum.get(key) ?? { n: 0, total: 0 };
			vehicleSum.set(key, { n: acc.n + 1, total: acc.total + count });
		}
		for (const [key, count] of Object.entries(bucket.matched)) {
			matched.set(key, (matched.get(key) ?? 0) + count);
		}
		for (const [key, count] of Object.entries(bucket.observed)) {
			observed.set(key, (observed.get(key) ?? 0) + count);
		}
	}
	return orderedLineKeys(config, vehicleSum.keys()).map((key) => {
		const acc = vehicleSum.get(key);
		return {
			avgVehicles: acc ? acc.total / acc.n : null,
			key,
			matchRate: hasTrainNoRule(key)
				? rate(matched.get(key) ?? 0, observed.get(key) ?? 0)
				: null,
		};
	});
}

/** 넣은 줄이 모두 쓰였는가. 세지 못한 날(null)은 이력으로 판정하지 않는다. */
function historyComplete(history: HistorySummary | null): boolean {
	if (history === null) {
		return true;
	}
	return [history.raw, history.events]
		.flatMap((bySource) => Object.values(bySource))
		.every((totals) => totals.written >= totals.buffered);
}

/**
 * 운행일 하나의 요약(`reports/<operatingDate>.json`). 운행일 D는 D 05:00 ~ D+1 01:00(KST, 설정값).
 * 응답을 받은 버킷이 없는 5분 칸이 3칸(15분) 이상 이어지면 그 구간을 멈춤으로 본다.
 */
export function buildDailyReport(
	operatingDate: string,
	buckets: readonly MetricsBucket[],
	config: CollectorConfig,
	history: HistorySummary | null = null
): DailyReport {
	const window = operatingWindow(operatingDate, config);
	const inWindow = buckets.filter(
		(b) => b.bucketStart >= window.from && b.bucketStart < window.to
	);
	const index = bucketIndex(inWindow);
	const sources = activeSources(config);
	const calls: DailyReport["calls"] = {};
	const errors: DailyReport["errors"] = {};
	for (const source of sources) {
		calls[source] = 0;
		errors[source] = {};
	}
	for (const bucket of inWindow) {
		calls[bucket.source] = (calls[bucket.source] ?? 0) + bucket.calls;
		const sourceErrors = errors[bucket.source] ?? {};
		addErrors(sourceErrors, bucket.errors);
		errors[bucket.source] = sourceErrors;
	}
	const stalledIntervals = sources.flatMap((source) =>
		stalledIntervalsOf(source, window, index)
	);
	const ok =
		stalledIntervals.length === 0 &&
		sources.every((source) => withinBudget(source, inWindow, config)) &&
		historyComplete(history);
	return {
		calls,
		errors,
		history,
		lines: reportLines(inWindow, config),
		ok,
		operatingDate,
		stalledIntervals,
		window,
	};
}

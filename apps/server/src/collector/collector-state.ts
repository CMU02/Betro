import { type AlertState, emptyAlertState } from "@Betro/realtime/alerts";
import {
	type BudgetKind,
	type BudgetState,
	emptyBudget,
} from "@Betro/realtime/budget";
import { dedupeRaw, sha256Hex } from "@Betro/realtime/history";
import {
	type AnyObservation,
	bucketStartOf,
	isSuccessfulOutcome,
	METRICS_BUCKET_MS,
	METRICS_RETENTION_DAYS,
	type MetricsBucket,
	type MetricsSource,
	recordCall,
} from "@Betro/realtime/metrics";
import type { CollectorConfig, ScheduleState } from "@Betro/realtime/schedule";
import { LatestState, type SavedState } from "@Betro/realtime/state";
import { kstParts } from "@Betro/realtime/time";
import type { UpstreamOutcome } from "@Betro/realtime/upstream/classify";
import { redactKeys } from "@Betro/realtime/upstream/urls";
import { SERVICE_ENDED_RECHECK_MS } from "./apply-call";
import {
	type CoreSaved,
	currentOperatingWindow,
	restoreCoreState,
	STATE_KEYS,
	type StopReason,
} from "./core-state";
import { HistoryWriter } from "./history-writer";
import type { StateStore, UpstreamResponse } from "./ports";
import { DAY_MS, latestSourceAt } from "./util";

const PRUNE_EVERY_MS = 3_600_000;
/**
 * 메모리에 들고 있는 5분 버킷 범위(지금 버킷과 그 앞 하나). 동시에 도는 호출은 시작 시각의
 * 버킷에 더하므로, 경계를 걸친 tick에서 이전 버킷 기록이 늦게 끝나도 그 버킷을 이어서 센다.
 */
const KEPT_BUCKETS_BEFORE = 1;
/** 운행 종료 다음 확인이 tick 간격·토큰 대기로 늦어질 수 있는 만큼의 여유. */
const RESTING_GRACE_MS = 120_000;

const bucketKey = (source: MetricsSource, bucketStart: number): string =>
	`${source}|${bucketStart}`;

/** 원본 이력 한 줄에 넣을 시도 정보. */
export interface RawAttempt {
	at: number;
	attempt: number;
	outcome: UpstreamOutcome;
	response: UpstreamResponse;
	stream: string;
	url: string;
}

/**
 * 수집기의 기억: 예산, 스케줄, 최신 상태, 소스 진행, 알림 상태, 이력 버퍼, 5분 지표.
 * `load`로 저장소에서 되살리고 `save`로 돌려 쓴다. 이력 버퍼(메모리)만 재시작 때 잃는다.
 */
export class CollectorState {
	budget: BudgetState;
	schedule: ScheduleState;
	latest: LatestState;
	core: CoreSaved;
	alerts: AlertState;
	readonly history: HistoryWriter;
	/** 저장소에서 되살린 시각. 상태를 아직 바꾸지 않은 스냅샷의 `generatedAt`. */
	readonly loadedAt: number;
	/** 소스별 최신 상태가 바뀔 때마다 오른다(스냅샷 캐시 무효화). */
	readonly versions: Record<MetricsSource, number> = { bus: 0, subway: 0 };
	readonly #secrets: readonly string[];
	/** `${source}|${bucketStart}` → 버킷. 저장소에서 되살린 값에 이어서 센다. */
	readonly #buckets = new Map<string, MetricsBucket>();
	readonly #dirtyBuckets = new Set<string>();

	private constructor(init: {
		alerts: AlertState;
		budget: BudgetState;
		buckets: readonly MetricsBucket[];
		core: CoreSaved;
		latest: LatestState;
		loadedAt: number;
		schedule: ScheduleState;
		secrets: readonly string[];
	}) {
		this.alerts = init.alerts;
		this.budget = init.budget;
		this.core = init.core;
		this.latest = init.latest;
		this.loadedAt = init.loadedAt;
		this.schedule = init.schedule;
		this.#secrets = init.secrets;
		this.history = new HistoryWriter(
			init.secrets,
			init.core.parts,
			undefined,
			init.core.historyLines
		);
		for (const bucket of init.buckets) {
			this.#buckets.set(bucketKey(bucket.source, bucket.bucketStart), bucket);
		}
	}

	static async load(
		store: StateStore,
		now: number,
		config: CollectorConfig,
		secrets: readonly string[]
	): Promise<CollectorState> {
		const [budget, schedule, latest, core, alerts, buckets] = await Promise.all(
			[
				store.get<BudgetState>(STATE_KEYS.budget),
				store.get<ScheduleState>(STATE_KEYS.schedule),
				store.get<SavedState>(STATE_KEYS.latest),
				store.get<CoreSaved>(STATE_KEYS.core),
				store.get<AlertState>(STATE_KEYS.alerts),
				store.metricsSince(
					bucketStartOf(now) - KEPT_BUCKETS_BEFORE * METRICS_BUCKET_MS
				),
			]
		);
		const restored = restoreCoreState(core, now, config);
		// 해시가 가리키는 본문이 아직 R2에 쓰이지 않은 채 버퍼와 함께 사라졌을 수 있다.
		// 재시작 뒤 스트림마다 첫 줄은 본문을 그대로 남긴다.
		restored.rawHashes = {};
		return new CollectorState({
			alerts: alerts ?? emptyAlertState(),
			buckets,
			budget: budget ?? emptyBudget(now),
			core: restored,
			latest: new LatestState(latest),
			loadedAt: now,
			schedule: schedule ?? { nextAt: {} },
			secrets,
		});
	}

	/** KST 날짜가 바뀌면 오늘 오류 수를 0부터 센다. */
	rollDay(now: number): void {
		const today = kstParts(now).date;
		if (this.core.kstDay === today) {
			return;
		}
		this.core.kstDay = today;
		for (const progress of Object.values(this.core.sources)) {
			progress.errorsToday = {};
		}
	}

	isStopped(kind: BudgetKind, now: number): boolean {
		return this.core.stopped[kind]?.day === kstParts(now).date;
	}

	/** 그날(KST) 401로 멈췄는가. 키 오류 알림이 따로 나가므로 멈춤 알림에서 뺀다. */
	isStoppedByAuth(kind: BudgetKind, now: number): boolean {
		return (
			this.isStopped(kind, now) && this.core.stopped[kind]?.reason === "auth"
		);
	}

	stop(kind: BudgetKind, reason: StopReason, at: number): void {
		this.core.stopped[kind] = { at, day: kstParts(at).date, reason };
		if (reason === "auth") {
			this.core.authFailedAt[kind] = at;
		}
	}

	/**
	 * 설정의 버스 노선이 모두 운행 종료로 쉬는 중인가. 지금 운행 시간 안에, 그리고 최근
	 * (다시 확인하는 간격 + 여유 안)에 운행 종료를 받은 노선만 센다. 운행 종료 뒤 상류가
	 * 계속 실패하면 표시가 지워지지 않으므로, 오래된 표시로 멈춤 알림을 막지 않는다.
	 */
	allBusRoutesResting(config: CollectorConfig, now: number): boolean {
		const window = currentOperatingWindow(now, config);
		const routes = config.busRouteIds;
		if (window === null || routes.length === 0) {
			return false;
		}
		const freshFrom = Math.max(
			window.from,
			now - SERVICE_ENDED_RECHECK_MS - RESTING_GRACE_MS
		);
		return routes.every(
			(routeId) => (this.core.restingRoutes[routeId] ?? -1) >= freshFrom
		);
	}

	setResting(routeId: string, resting: boolean, at: number): void {
		if (resting) {
			this.core.restingRoutes[routeId] = at;
		} else {
			delete this.core.restingRoutes[routeId];
		}
	}

	/** 소스의 최신 상태가 바뀌었다. 스냅샷 `generatedAt`을 이 시각으로 고정한다. */
	touch(kind: MetricsSource, at: number): void {
		this.core.changedAt[kind] = at;
		this.versions[kind] += 1;
	}

	addEvents(
		stream: MetricsSource,
		at: number,
		events: readonly AnyObservation[]
	): void {
		for (const event of events) {
			this.history.events.add(stream, at, event);
		}
	}

	/**
	 * 원본 한 줄. 본문이 직전과 같으면 해시만 남긴다. 본문·오류 문구는 JSON으로 직렬화하기
	 * 전에 키를 지운다(직렬화하면 본문 안의 `\/`가 `\\/`로 바뀌어 변형 목록과 맞지 않는다).
	 * 버퍼도 직렬화한 줄에서 한 번 더 지운다.
	 */
	async addRaw(raw: RawAttempt): Promise<void> {
		const { response, stream } = raw;
		const body = redactKeys(response.body, this.#secrets);
		const error =
			response.error === undefined
				? undefined
				: redactKeys(response.error, this.#secrets);
		const bodyHash = await sha256Hex(body);
		const record = dedupeRaw(this.core.rawHashes[stream], {
			body,
			bodyHash,
			fetchedAt: raw.at,
			request: redactKeys(raw.url, this.#secrets),
			source: stream,
			status: response.status,
		});
		this.core.rawHashes[stream] = bodyHash;
		this.history.raw.add(stream, raw.at, {
			...record,
			attempt: raw.attempt,
			outcome: raw.outcome,
			...(error ? { error } : {}),
		});
	}

	/** 시도 한 번을 5분 지표와 소스 진행에 더한다. */
	recordAttempt(
		kind: MetricsSource,
		at: number,
		outcome: UpstreamOutcome,
		observations: readonly AnyObservation[]
	): void {
		const key = bucketKey(kind, bucketStartOf(at));
		const bucket = recordCall(
			this.#buckets.get(key),
			at,
			kind,
			outcome,
			observations
		);
		this.#buckets.set(key, bucket);
		this.#dirtyBuckets.add(key);
		const progress = this.core.sources[kind];
		if (outcome !== "ok") {
			progress.errorsToday[outcome] = (progress.errorsToday[outcome] ?? 0) + 1;
		}
		if (isSuccessfulOutcome(outcome)) {
			progress.lastSuccessAt = at;
		}
		const sourceAt = latestSourceAt(observations);
		if (sourceAt !== null) {
			progress.lastSourceAt = sourceAt;
		}
	}

	/** TTL이 지난 차량을 빼고, 빠진 게 있으면 그 소스를 바뀐 것으로 본다. */
	expire(now: number): void {
		const before = this.latest.save();
		this.latest.expire(now);
		const after = this.latest.save();
		if (after.subway.trains.length !== before.subway.trains.length) {
			this.touch("subway", now);
		}
		if (after.bus.vehicles.length !== before.bus.vehicles.length) {
			this.touch("bus", now);
		}
	}

	async saveCore(store: StateStore): Promise<void> {
		this.core.parts = this.history.parts;
		this.core.historyLines = this.history.lineCounts;
		await store.put(STATE_KEYS.core, this.core);
	}

	/** 저장을 마친 오래된 버킷은 메모리에서 뺀다(저장소에 남아 있다). */
	#dropOldBuckets(now: number): void {
		const keepFrom =
			bucketStartOf(now) - KEPT_BUCKETS_BEFORE * METRICS_BUCKET_MS;
		for (const [key, bucket] of this.#buckets) {
			if (bucket.bucketStart < keepFrom) {
				this.#buckets.delete(key);
			}
		}
	}

	/** 알림 상태는 `evaluateAlerts`가 따로 저장한다. */
	async save(store: StateStore, now: number): Promise<void> {
		const buckets = [...this.#dirtyBuckets]
			.map((key) => this.#buckets.get(key))
			.filter((bucket): bucket is MetricsBucket => bucket !== undefined);
		this.#dirtyBuckets.clear();
		this.#dropOldBuckets(now);
		const lastPruned = this.core.lastPrunedAt;
		const prune = lastPruned === null || now - lastPruned >= PRUNE_EVERY_MS;
		if (prune) {
			this.core.lastPrunedAt = now;
		}
		await Promise.all([
			store.put(STATE_KEYS.budget, this.budget),
			store.put(STATE_KEYS.schedule, this.schedule),
			store.put(STATE_KEYS.latest, this.latest.save()),
			this.saveCore(store),
			...buckets.map((bucket) => store.putMetrics(bucket)),
		]);
		if (prune) {
			await store.pruneMetrics(now - METRICS_RETENTION_DAYS * DAY_MS);
		}
	}
}

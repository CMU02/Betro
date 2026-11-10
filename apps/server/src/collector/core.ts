import type { ReferenceBatchKind } from "@Betro/db/schema/transit";
import { consume, remaining } from "@Betro/realtime/budget";
import { sha256Hex } from "@Betro/realtime/history";
import {
	type AnyObservation,
	buildStatus,
	type CollectorStatus,
	countByLine,
	METRICS_BUCKET_MS,
	METRICS_RETENTION_DAYS,
} from "@Betro/realtime/metrics";
import {
	type CallPlan,
	planKey,
	planTick,
	type TokenBucket,
	takeToken,
} from "@Betro/realtime/schedule";
import { isOperatingTime } from "@Betro/realtime/time";
import type { UpstreamOutcome } from "@Betro/realtime/upstream/classify";
import { redactKeys } from "@Betro/realtime/upstream/urls";
import { applyCall, type References } from "./apply-call";
import { CollectorState } from "./collector-state";
import { currentOperatingEnd, type StationRowsEntry } from "./core-state";
import type { CollectorPorts, UpstreamResponse } from "./ports";
import { evaluateAlerts, writeReportIfDue } from "./reporting";
import {
	budgetKindOf,
	isRetryable,
	parseCall,
	RETRY_BACKOFF_MS,
	rawStreamOf,
	safeFetch,
	urlOf,
} from "./upstream-call";
import {
	batchSignature,
	DAY_MS,
	errorText,
	runLimited,
	secretVariants,
} from "./util";

/** D1 현재 배치를 다시 확인하는 간격. */
export const REFERENCE_CHECK_MS = 300_000;
/** 참조를 하나도 못 읽었을 때 다시 깨어나는 간격. */
const REFERENCE_RETRY_MS = 60_000;
/** R2에 못 쓴 이력·보고서가 남았을 때 다시 깨어나는 간격. */
export const BACKLOG_RETRY_MS = 300_000;
/**
 * 다음 alarm까지 이만큼 남으면 이력을 미리 쓴다(`CollectorPorts.idleFlushMs` 운영 기본값).
 * Cloudflare는 요청·alarm 없이 10초가 지나면 DO를 재우고 메모리를 비우므로 그보다 짧아야 한다.
 * 60초였을 때는 alarm 간격이 10~60초인 동안 이력이 R2에 쓰이지 않고 사라졌다(2026-11-09).
 */
export const DEFAULT_IDLE_FLUSH_MS = 5000;
/** 한 tick 안에서 동시에 여는 상류 연결 수(Workers 동시 연결 6). */
const MAX_PARALLEL_CALLS = 6;
const ETAG_LENGTH = 16;
const SUBWAY_REFERENCE_KINDS: readonly ReferenceBatchKind[] = [
	"station_crosswalk",
	"track",
	"timetable",
];
const BUS_REFERENCE_KINDS: readonly ReferenceBatchKind[] = ["bus_route"];

export type SnapshotKind = "subway" | "bus";

export interface SnapshotResponse {
	body: string;
	etag: string;
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 수집기 본체. Durable Object는 포트를 넣어 이 클래스를 한 번 만들고 alarm마다 `tick`을 부른다.
 * 재시작 뒤에도 이어져야 하는 값은 `StateStore`에 두고(`CollectorState`), 첫 호출 때 되살린다.
 */
export class CollectorCore {
	readonly #ports: CollectorPorts;
	readonly #secrets: readonly string[];
	readonly #sleep: (ms: number) => Promise<void>;
	#loading: Promise<CollectorState> | null = null;
	#queue: Promise<unknown> = Promise.resolve();
	#refs: References | null = null;
	#refsCheckedAt: number | null = null;
	#busTokens: TokenBucket | null = null;
	readonly #warned = new Set<string>();
	readonly #snapshots = new Map<
		SnapshotKind,
		{ version: number; response: SnapshotResponse }
	>();

	constructor(ports: CollectorPorts) {
		this.#ports = ports;
		this.#secrets = secretVariants([ports.keys.subway, ports.keys.bus]);
		this.#sleep = ports.sleep ?? defaultSleep;
	}

	/**
	 * 한 주기: 복원 → 참조 확인 → `planTick` → 호출(재시도 포함, 시도마다 예산) → 분류 → 정규화
	 * → 최신 상태 → 이력 버퍼 → 지표 → 저장 → 필요하면 flush → 일일 보고서 → 알림.
	 */
	tick(): Promise<{ nextAlarmAt: number }> {
		return this.#exclusive(() => this.#tick());
	}

	/** cron(5분)용: 알림 판단만 하고 알림 상태를 저장한다. */
	healthCheck(): Promise<void> {
		return this.#exclusive(async () => {
			const state = await this.#state();
			const now = this.#ports.clock();
			state.rollDay(now);
			await evaluateAlerts(state, this.#ports, now, this.#log);
		});
	}

	/** `GET /v1/snapshot/:kind` 본문. 최신 상태가 바뀌지 않았으면 같은 본문·ETag. */
	async snapshot(kind: SnapshotKind): Promise<SnapshotResponse> {
		const state = await this.#state();
		const version = state.versions[kind];
		const cached = this.#snapshots.get(kind);
		if (cached?.version === version) {
			return cached.response;
		}
		const generatedAt = state.core.changedAt[kind] ?? state.loadedAt;
		const body = JSON.stringify(state.latest.snapshot(kind, generatedAt));
		const etag = (await sha256Hex(body)).slice(0, ETAG_LENGTH);
		const response = { body, etag };
		this.#snapshots.set(kind, { response, version });
		return response;
	}

	/**
	 * 출퇴근 세션이 보는 역을 `until`까지 등록한다. 이후 ALL 응답마다 그 역의 행을 남긴다.
	 * 만료 시각이 지난 역은 지운다. 진행 중인 tick을 기다리지 않는다(메모리의 같은 값을 바꾸고 바로 저장).
	 */
	async watchStations(statnIds: string[], until: number): Promise<void> {
		const state = await this.#state();
		state.watchStations(statnIds, until);
		state.expireWatches(this.#ports.clock());
		await state.saveBoards(this.#ports.state);
	}

	/** 등록한 역 중 행을 받은 역의 최근 행. 받지 못한 역은 키가 없다. */
	async stationRows(
		statnIds: string[]
	): Promise<Record<string, StationRowsEntry>> {
		const state = await this.#state();
		const result: Record<string, StationRowsEntry> = {};
		for (const statnId of statnIds) {
			const entry = state.boards.stations[statnId];
			if (entry) {
				result[statnId] = entry;
			}
		}
		return result;
	}

	/** 상태 페이지·`/status.json`. */
	async status(): Promise<CollectorStatus> {
		const state = await this.#state();
		const now = this.#ports.clock();
		state.rollDay(now);
		const recentBuckets = await this.#ports.state.metricsSince(
			now - METRICS_RETENTION_DAYS * DAY_MS - METRICS_BUCKET_MS
		);
		const vehicles: AnyObservation[] = [
			...state.latest.snapshot("subway", now).vehicles,
			...state.latest.snapshot("bus", now).vehicles,
		];
		return buildStatus({
			budget: state.budget,
			config: this.#ports.config,
			lineCounts: countByLine(vehicles),
			now,
			recentBuckets,
			sources: state.core.sources,
		});
	}

	/**
	 * D1 현재 배치가 바뀌었거나 아직 읽지 않았으면 참조를 다시 읽는다(바뀐 쪽만).
	 * 다시 읽었으면 true. 진행 중인 주기는 시작할 때 잡은 참조를 끝까지 쓴다.
	 * `tick`이 5분마다 부르고, DO가 배치 교체 직후 바로 부를 수도 있다.
	 */
	async refreshReferences(): Promise<boolean> {
		const { config, reference } = this.#ports;
		const ids = await reference.currentBatchIds();
		const subwayIds = batchSignature(ids, SUBWAY_REFERENCE_KINDS);
		const busIds = batchSignature(ids, BUS_REFERENCE_KINDS);
		const prev = this.#refs;
		const [subway, bus] = await Promise.all([
			prev?.subwayIds === subwayIds ? prev.subway : reference.loadSubway(),
			prev?.busIds === busIds
				? prev.bus
				: reference.loadBus([...config.busRouteIds], config.mode === "dev"),
		]);
		this.#refsCheckedAt = this.#ports.clock();
		const changed = prev?.subway !== subway || prev?.bus !== bus;
		this.#refs = { bus, busIds, subway, subwayIds };
		if (changed) {
			this.#log(`references loaded subway[${subwayIds}] bus[${busIds}]`);
		}
		return changed;
	}

	#exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(fn, fn);
		this.#queue = run.catch(() => undefined);
		return run;
	}

	#warnOnce(tag: string, line: string): void {
		if (!this.#warned.has(tag)) {
			this.#warned.add(tag);
			this.#log(line);
		}
	}

	readonly #log = (line: string): void => {
		this.#ports.log(redactKeys(line, this.#secrets));
	};

	#state(): Promise<CollectorState> {
		this.#loading ??= CollectorState.load(
			this.#ports.state,
			this.#ports.clock(),
			this.#ports.config,
			this.#secrets
		).catch((error: unknown) => {
			this.#loading = null;
			throw error;
		});
		return this.#loading;
	}

	/** 참조가 없거나 확인할 때가 됐으면 D1을 본다. */
	async #references(now: number): Promise<References | null> {
		const due =
			this.#refs === null ||
			this.#refsCheckedAt === null ||
			now - this.#refsCheckedAt >= REFERENCE_CHECK_MS;
		if (due) {
			try {
				await this.refreshReferences();
			} catch (error) {
				this.#refsCheckedAt = now;
				this.#log(`references failed: ${errorText(error)}`);
			}
		}
		return this.#refs;
	}

	async #tick(): Promise<{ nextAlarmAt: number }> {
		const state = await this.#state();
		const { blobs, clock, config } = this.#ports;
		const now = clock();
		state.rollDay(now);
		state.expireWatches(now);
		const refs = await this.#references(now);
		const planned = refs
			? await this.#poll(state, refs, now)
			: this.#retryLater(state, now);
		const end = clock();
		state.expire(end);
		const operating = isOperatingTime(
			end,
			config.operatingStart,
			config.operatingEnd
		);
		// 다음 alarm까지 오래 쉬면 DO가 내려가 메모리 버퍼를 잃을 수 있으므로 미리 쓴다.
		const { idleFlushMs } = this.#ports;
		const goingIdle = idleFlushMs !== undefined && planned - end >= idleFlushMs;
		await state.history.write(blobs, end, !operating || goingIdle, {
			onError: (key, error) =>
				this.#log(`history write ${key} failed: ${errorText(error)}`),
			persistParts: () => state.saveCore(this.#ports.state),
		});
		await state.save(this.#ports.state, end);
		const reportsDone = await writeReportIfDue(
			state,
			this.#ports,
			end,
			this.#log
		);
		await evaluateAlerts(state, this.#ports, end, this.#log);
		// 운행이 끝나는 시각에 한 번 더 깨어나 이력을 비우고 일일 보고서를 쓴다.
		const operatingEnd = currentOperatingEnd(now, config);
		let nextAlarmAt =
			operatingEnd !== null && planned > operatingEnd ? operatingEnd : planned;
		// 못 쓴 이력 조각(메모리에만 있다)이나 보고서가 남았으면 다음 운행까지 기다리지 않는다.
		if (state.history.pendingCount > 0 || !reportsDone) {
			nextAlarmAt = Math.min(nextAlarmAt, end + BACKLOG_RETRY_MS);
		}
		return { nextAlarmAt };
	}

	/** 계획대로 부르고 다음 alarm 시각을 돌려준다. 그날 멈춘 소스는 건너뛴다. */
	async #poll(
		state: CollectorState,
		refs: References,
		now: number
	): Promise<number> {
		const plan = planTick(
			now,
			state.schedule,
			state.budget,
			this.#ports.config
		);
		state.schedule = plan.schedule;
		const due = plan.due.filter(
			(call) => !state.isStopped(budgetKindOf(call), now)
		);
		await runLimited(due, MAX_PARALLEL_CALLS, (call) =>
			this.#call(state, refs, call)
		);
		return plan.nextAlarmAt;
	}

	#retryLater(state: CollectorState, now: number): number {
		const { config } = this.#ports;
		if (isOperatingTime(now, config.operatingStart, config.operatingEnd)) {
			return now + REFERENCE_RETRY_MS;
		}
		return planTick(now, state.schedule, state.budget, config).nextAlarmAt;
	}

	async #call(
		state: CollectorState,
		refs: References,
		plan: CallPlan
	): Promise<void> {
		try {
			await this.#attempt(state, refs, plan, 0);
		} catch (error) {
			this.#log(`${planKey(plan)} failed: ${errorText(error)}`);
		}
	}

	/**
	 * 시도 한 번(예산 1건). 재시도할 결과면 백오프 뒤 다음 시도로 넘어간다.
	 * 동시에 도는 다른 호출(재시도 포함)이 예산을 다 썼거나 소스를 멈췄으면 부르지 않는다.
	 */
	async #attempt(
		state: CollectorState,
		refs: References,
		plan: CallPlan,
		attempt: number
	): Promise<void> {
		const { clock, config, keys, upstream } = this.#ports;
		const kind = budgetKindOf(plan);
		const url = urlOf(plan, keys);
		await this.#waitForBusToken(plan);
		const at = clock();
		if (state.isStopped(kind, at)) {
			return;
		}
		if (remaining(state.budget, kind, config, at) <= 0) {
			this.#log(`${planKey(plan)} skipped: ${kind} budget exhausted`);
			return;
		}
		state.budget = consume(state.budget, kind, at);
		const response = await safeFetch(upstream, url);
		// 관측 시각은 응답을 받은 시각이다. 요청 시작 시각을 쓰면 느린 응답(ALL 1.8MB)의
		// 정상 recptnDt가 '미래 시각'으로 잘못 잡힌다. 예산·지표 버킷·마지막 성공은 시작 시각 `at`으로 센다.
		const receivedAt = clock();
		const parsed = parseCall(plan, response);
		const { outcome } = parsed;
		await state.addRaw({
			at: receivedAt,
			attempt,
			outcome,
			response,
			stream: rawStreamOf(plan),
			url,
		});
		const backoff = RETRY_BACKOFF_MS[attempt];
		const retry =
			backoff !== undefined &&
			isRetryable(outcome) &&
			remaining(state.budget, kind, config, clock()) > 0;
		this.#logOutcome(plan, response, outcome, attempt, retry);
		if (retry) {
			state.recordAttempt(kind, at, outcome, []);
			await this.#sleep(backoff);
			await this.#attempt(state, refs, plan, attempt + 1);
			return;
		}
		const observations = applyCall(
			state,
			refs,
			parsed,
			receivedAt,
			(tag, line) => this.#warnOnce(tag, line)
		);
		if (
			parsed.kind === "subway-all" &&
			(outcome === "ok" || outcome === "no-data")
		) {
			state.recordStationRows(parsed.rows, receivedAt);
		}
		if (outcome === "auth" || outcome === "quota-exhausted") {
			state.stop(kind, outcome, at);
			this.#log(`${kind} stopped for the day: ${outcome}`);
		}
		state.recordAttempt(kind, at, outcome, observations);
	}

	/** `prod` 버스는 초당 호출 수를 토큰 버킷으로 막는다. */
	async #waitForBusToken(plan: CallPlan): Promise<void> {
		const rate = this.#ports.config.busRequestsPerSecond;
		if (plan.kind !== "bus" || !rate) {
			return;
		}
		const now = this.#ports.clock();
		this.#busTokens ??= { tokens: rate, updatedAt: now };
		const taken = takeToken(this.#busTokens, now, rate);
		this.#busTokens = taken.bucket;
		if (!taken.ok) {
			await this.#sleep(taken.waitMs);
			await this.#waitForBusToken(plan);
		}
	}

	#logOutcome(
		plan: CallPlan,
		response: UpstreamResponse,
		outcome: UpstreamOutcome,
		attempt: number,
		retry: boolean
	): void {
		if (outcome === "ok") {
			return;
		}
		const error = response.error ? ` error=${response.error}` : "";
		const next = retry ? " retrying" : "";
		this.#log(
			`${planKey(plan)} ${outcome} status=${response.status ?? "none"} attempt=${attempt}${error}${next}`
		);
	}
}

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
import type { BusReference } from "@Betro/realtime/reference";
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
	metricsSourceOf,
	parseCall,
	rawStreamOf,
	regionalRouteKey,
	retryBackoffOf,
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
/**
 * 관측 요청이 받는 노선 키. 서울은 맨 숫자 ID, 지역은 출처를 붙인 키(`gbis:<숫자>`,
 * `tago:<영문 3자><숫자>`). 상류 URL에 그대로 들어가므로 이 꼴만 받는다.
 */
const BUS_ROUTE_ID = /^\d+$|^gbis:\d+$|^tago:[A-Z]{3}\d+$/;

/** 버스 참조와 그 참조를 읽을 때 요청한 노선(D1에 없던 노선도 든다). */
interface LoadedBus {
	bus: BusReference;
	routeIds: ReadonlySet<string>;
}

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
	/** `#refs.bus`를 읽을 때 요청한 노선. 관측 요청 노선이 바뀌었는지 이것과 견준다. */
	#busRouteIds: ReadonlySet<string> = new Set();
	#busTokens: TokenBucket | null = null;
	readonly #warned = new Set<string>();
	readonly #snapshots = new Map<
		SnapshotKind,
		{ version: number; stopped: string; response: SnapshotResponse }
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

	/**
	 * `GET /v1/snapshot/:kind` 본문. 최신 상태와 그날 멈춘 지역 출처가 바뀌지 않았으면 같은
	 * 본문·ETag. 멈춤은 다음 KST 날 저절로 풀리므로 캐시 키에 넣는다.
	 */
	async snapshot(kind: SnapshotKind): Promise<SnapshotResponse> {
		const state = await this.#state();
		const version = state.versions[kind];
		const stoppedSources =
			kind === "bus" ? state.stoppedSources(this.#ports.clock()) : [];
		const stopped = stoppedSources.join(",");
		const cached = this.#snapshots.get(kind);
		if (cached?.version === version && cached.stopped === stopped) {
			return cached.response;
		}
		const generatedAt = state.core.changedAt[kind] ?? state.loadedAt;
		const body = JSON.stringify(
			state.latest.snapshot(kind, generatedAt, stoppedSources)
		);
		const etag = (await sha256Hex(body)).slice(0, ETAG_LENGTH);
		const response = { body, etag };
		this.#snapshots.set(kind, { response, stopped, version });
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

	/**
	 * 설치 하나의 지도 버스 관측 요청을 `until`까지로 통째로 바꾼다(빈 배열이면 지운다).
	 * 다음 tick부터 설정 노선보다 먼저 부른다. `watchStations`처럼 진행 중인 tick을 기다리지 않는다.
	 */
	async watchBusRoutes(
		installId: string,
		routeIds: readonly string[],
		until: number
	): Promise<void> {
		const { clock, config } = this.#ports;
		if (!routeIds.every((routeId) => BUS_ROUTE_ID.test(routeId))) {
			throw new Error(
				"bus route ids must be numeric, gbis:<digits> or tago:<AAA><digits>"
			);
		}
		const unique = [...new Set(routeIds)];
		if (unique.length > config.mapWatchMaxPerInstall) {
			throw new Error(
				`an install may watch at most ${config.mapWatchMaxPerInstall} bus routes`
			);
		}
		const state = await this.#state();
		state.watchBusRoutes(installId, unique, until);
		state.expireBusWatches(clock());
		await state.saveBusWatch(this.#ports.state);
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
	 * 버스 배치가 그대로여도 관측 요청 노선이 바뀌었으면 새 노선만 더 읽는다.
	 * 다시 읽었으면 true. 진행 중인 주기는 시작할 때 잡은 참조를 끝까지 쓴다.
	 * `tick`이 5분마다 부르고, DO가 배치 교체 직후 바로 부를 수도 있다.
	 */
	async refreshReferences(): Promise<boolean> {
		const { reference } = this.#ports;
		const wanted = await this.#wantedBusRouteIds();
		const ids = await reference.currentBatchIds();
		const subwayIds = batchSignature(ids, SUBWAY_REFERENCE_KINDS);
		const busIds = batchSignature(ids, BUS_REFERENCE_KINDS);
		const prev = this.#refs;
		const [subway, loaded] = await Promise.all([
			prev?.subwayIds === subwayIds ? prev.subway : reference.loadSubway(),
			prev?.busIds === busIds
				? this.#syncBus(prev.bus, wanted)
				: this.#loadBus(wanted),
		]);
		this.#refsCheckedAt = this.#ports.clock();
		const changed = prev?.subway !== subway || prev?.bus !== loaded.bus;
		this.#refs = { bus: loaded.bus, busIds, subway, subwayIds };
		this.#busRouteIds = loaded.routeIds;
		if (changed) {
			this.#log(`references loaded subway[${subwayIds}] bus[${busIds}]`);
		}
		return changed;
	}

	/** 버스 참조가 필요한 노선: 설정 노선과 지금 유효한 관측 요청 노선. */
	async #wantedBusRouteIds(): Promise<string[]> {
		const { clock, config } = this.#ports;
		const state = await this.#state();
		return [
			...new Set([
				...config.busRouteIds,
				...state.watchedBusRouteIds(clock(), config.mapWatchMaxTotal),
			]),
		];
	}

	async #loadBus(routeIds: readonly string[]): Promise<LoadedBus> {
		const { config, reference } = this.#ports;
		const bus = await reference.loadBus([...routeIds], config.mode === "dev");
		return { bus, routeIds: new Set(routeIds) };
	}

	/**
	 * 같은 배치의 버스 참조를 `wanted` 노선에 맞춘다. 새 노선만 D1에서 읽고, 더는 요청하지 않는
	 * 노선은 메모리에서 뺀다. 바뀐 게 없으면 같은 참조를 돌려준다. 읽는 사이 배치가 바뀌었으면
	 * 전부 다시 읽는다.
	 */
	async #syncBus(
		prev: BusReference,
		wanted: readonly string[]
	): Promise<LoadedBus> {
		const wantedSet = new Set(wanted);
		const added = wanted.filter((routeId) => !this.#busRouteIds.has(routeId));
		const removed = [...this.#busRouteIds].some(
			(routeId) => !wantedSet.has(routeId)
		);
		if (added.length === 0 && !removed) {
			return { bus: prev, routeIds: this.#busRouteIds };
		}
		const { config, reference } = this.#ports;
		const extra =
			added.length > 0
				? await reference.loadBus(added, config.mode === "dev")
				: null;
		if (extra && extra.batchId !== prev.batchId) {
			return this.#loadBus(wanted);
		}
		const routes = new Map(
			[...prev.routes].filter(([routeId]) => wantedSet.has(routeId))
		);
		for (const [routeId, route] of extra?.routes ?? []) {
			routes.set(routeId, route);
		}
		return { bus: { batchId: prev.batchId, routes }, routeIds: wantedSet };
	}

	/** 배치 확인 사이에도 관측 요청 노선이 바뀌면 버스 참조를 맞춘다. */
	async #syncWatchedBus(): Promise<void> {
		const refs = this.#refs;
		if (refs === null) {
			return;
		}
		const loaded = await this.#syncBus(
			refs.bus,
			await this.#wantedBusRouteIds()
		);
		if (loaded.bus !== refs.bus && this.#refs === refs) {
			this.#refs = { ...refs, bus: loaded.bus };
			this.#busRouteIds = loaded.routeIds;
			this.#log(`bus references synced routes=${loaded.routeIds.size}`);
		}
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
			return this.#refs;
		}
		try {
			await this.#syncWatchedBus();
		} catch (error) {
			this.#log(`bus references sync failed: ${errorText(error)}`);
		}
		return this.#refs;
	}

	async #tick(): Promise<{ nextAlarmAt: number }> {
		const state = await this.#state();
		const { blobs, clock, config } = this.#ports;
		const now = clock();
		state.rollDay(now);
		state.expireWatches(now);
		state.expireBusWatches(now);
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
		const { config } = this.#ports;
		const plan = planTick(
			now,
			state.schedule,
			state.budget,
			config,
			state.watchedBusRouteIds(now, config.mapWatchMaxTotal)
		);
		state.schedule = plan.schedule;
		const due = plan.due
			.filter((call) => !state.isStopped(budgetKindOf(call), now))
			.flatMap((call) => {
				const resolved = this.#resolveRegional(refs, call);
				return resolved ? [resolved] : [];
			});
		await runLimited(due, MAX_PARALLEL_CALLS, (call) =>
			this.#call(state, refs, call)
		);
		return plan.nextAlarmAt;
	}

	/**
	 * 지역 호출에 참조의 TAGO 도시 코드를 채운다. 참조에 없는 노선(지도에 놓을 수 없다)이나
	 * 도시 코드를 모르는 TAGO 노선은 예산을 쓰지 않고 건너뛴다(null). 다른 호출은 그대로.
	 */
	#resolveRegional(refs: References, call: CallPlan): CallPlan | null {
		if (call.kind !== "regional-bus") {
			return call;
		}
		const key = regionalRouteKey(call.source, call.routeId);
		const route = refs.bus.routes.get(key);
		if (!route) {
			this.#warnOnce(`missing:${key}`, `${key} skipped: not in bus references`);
			return null;
		}
		if (call.source === "gbis") {
			return call;
		}
		if (!route.cityCode) {
			this.#warnOnce(`city:${key}`, `${key} skipped: no TAGO city code`);
			return null;
		}
		return { ...call, cityCode: route.cityCode };
	}

	#retryLater(state: CollectorState, now: number): number {
		const { config } = this.#ports;
		if (isOperatingTime(now, config.operatingStart, config.operatingEnd)) {
			return now + REFERENCE_RETRY_MS;
		}
		return planTick(
			now,
			state.schedule,
			state.budget,
			config,
			state.watchedBusRouteIds(now, config.mapWatchMaxTotal)
		).nextAlarmAt;
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
		const backoff = retryBackoffOf(plan, attempt);
		const retry =
			backoff !== undefined &&
			isRetryable(outcome) &&
			remaining(state.budget, kind, config, clock()) > 0;
		this.#logOutcome(plan, response, outcome, attempt, retry);
		const source = metricsSourceOf(plan);
		if (retry) {
			if (source) {
				state.recordAttempt(source, at, outcome, []);
			}
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
			if (plan.kind === "regional-bus") {
				// 스냅샷 `stoppedSources`가 바뀌었다.
				state.touch("bus", at);
			}
		}
		if (source) {
			state.recordAttempt(source, at, outcome, observations);
		}
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

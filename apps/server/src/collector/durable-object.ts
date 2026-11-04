import type { CollectorStatus } from "@Betro/realtime/metrics";
import { redactKeys } from "@Betro/realtime/upstream/urls";
import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "@cloudflare/workers-types";
import type { Env } from "../worker-env";
import {
	collectorConfig,
	D1ReferenceSource,
	FcmNotifier,
	R2BlobStore,
	SqlStateStore,
	upstreamFor,
} from "./cf-ports";
import type { CollectorStartResult } from "./client";
import {
	CollectorCore,
	type SnapshotKind,
	type SnapshotResponse,
} from "./core";
import { errorText, secretVariants } from "./util";

/** `start()`를 한 번이라도 불렀는지(`kv`). cron은 시작한 수집기의 alarm만 다시 건다. */
const STARTED_KEY = "started";
/** `tick`이 던졌을 때 다시 깨어나는 간격. */
const TICK_FAILURE_RETRY_MS = 60_000;
/** alarm을 너무 촘촘히 걸지 않는다. */
const MIN_ALARM_DELAY_MS = 1000;
/**
 * 다음 alarm까지 이만큼 남으면 이력을 미리 쓴다. 운영에서 쉬는 DO는 70~140초 뒤 내려갈 수 있어
 * 그보다 짧게 둔다(`dev`는 alarm 간격이 약 80초라 사실상 tick마다 조각 하나씩 쓴다).
 */
const DEFAULT_IDLE_FLUSH_MS = 60_000;

function idleFlushMsOf(env: Env): number {
	const value = Number(env.HISTORY_IDLE_FLUSH_MS);
	return Number.isInteger(value) && value > 0 ? value : DEFAULT_IDLE_FLUSH_MS;
}

const isSnapshotKind = (value: unknown): value is SnapshotKind =>
	value === "subway" || value === "bus";

/**
 * 수집기 Durable Object. `fetch`는 쓰지 않고 RPC 메서드만 둔다. alarm마다 `CollectorCore.tick`을
 * 부르고 돌려받은 시각으로 다음 alarm을 건다. `CollectorCore`는 인스턴스당 한 번만 만든다.
 */
export class Collector extends DurableObject<Env> {
	readonly #store: SqlStateStore;
	readonly #log: (line: string) => void;
	#core: Promise<CollectorCore> | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#store = new SqlStateStore(ctx.storage.sql);
		const secrets = secretVariants([
			env.SEOUL_OPEN_API_KEY ?? "",
			env.DATA_GO_KR_API_KEY ?? "",
		]);
		this.#log = (line) => {
			console.log(redactKeys(line, secrets));
		};
	}

	/** 수집을 시작한다. alarm이 없으면 지금으로 건다. */
	async start(): Promise<CollectorStartResult> {
		const now = Date.now();
		await this.#store.put(STARTED_KEY, now);
		const existing = await this.ctx.storage.getAlarm();
		if (existing !== null) {
			return { alarmAt: existing, alreadyRunning: true };
		}
		await this.ctx.storage.setAlarm(now);
		this.#log(`collector started alarm=${new Date(now).toISOString()}`);
		return { alarmAt: now, alreadyRunning: false };
	}

	async snapshot(kind: SnapshotKind): Promise<SnapshotResponse> {
		if (!isSnapshotKind(kind)) {
			throw new Error("snapshot kind must be subway or bus");
		}
		const core = await this.#getCore();
		return core.snapshot(kind);
	}

	async status(): Promise<CollectorStatus> {
		const core = await this.#getCore();
		return core.status();
	}

	/**
	 * cron(5분)용. 시작한 수집기의 alarm이 사라졌으면(재시도 소진 등) 다시 걸고, 알림을 판단한다.
	 */
	async healthCheck(): Promise<void> {
		const started = await this.#store.get<number>(STARTED_KEY);
		// 아직 시작하지 않은 수집기는 성공 기록이 없어 '멈춤'으로 보인다. 알림을 내지 않는다.
		if (started === undefined) {
			return;
		}
		if ((await this.ctx.storage.getAlarm()) === null) {
			this.#log("collector alarm missing, re-arming");
			await this.ctx.storage.setAlarm(Date.now());
		}
		const core = await this.#getCore();
		await core.healthCheck();
	}

	async alarm(): Promise<void> {
		let nextAlarmAt: number;
		try {
			const core = await this.#getCore();
			({ nextAlarmAt } = await core.tick());
		} catch (error) {
			this.#log(`collector tick failed: ${errorText(error)}`);
			nextAlarmAt = Date.now() + TICK_FAILURE_RETRY_MS;
		}
		await this.ctx.storage.setAlarm(
			Math.max(nextAlarmAt, Date.now() + MIN_ALARM_DELAY_MS)
		);
	}

	#getCore(): Promise<CollectorCore> {
		this.#core ??= this.#createCore().catch((error: unknown) => {
			this.#core = null;
			throw error;
		});
		return this.#core;
	}

	async #createCore(): Promise<CollectorCore> {
		const { env } = this;
		const reference = new D1ReferenceSource(env.DB);
		const config = await collectorConfig(env, reference);
		const { mode: upstreamMode, upstream } = upstreamFor(env);
		const clock = () => Date.now();
		const notifier = new FcmNotifier({
			clock,
			deviceToken: env.ALERT_FCM_TOKEN,
			log: this.#log,
			serviceAccountJson: env.FCM_SERVICE_ACCOUNT_JSON,
		});
		this.#log(
			`collector core mode=${config.mode} upstream=${upstreamMode} fcm=${notifier.configured ? "on" : "log-only"}`
		);
		return new CollectorCore({
			blobs: new R2BlobStore(env.DATA),
			clock,
			config,
			idleFlushMs: idleFlushMsOf(env),
			keys: {
				bus: env.DATA_GO_KR_API_KEY ?? "",
				subway: env.SEOUL_OPEN_API_KEY ?? "",
			},
			log: this.#log,
			notifier,
			reference,
			state: this.#store,
			upstream,
		});
	}
}

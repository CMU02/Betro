import type { SessionInput } from "@Betro/commute/session/stage";
import { redactKeys } from "@Betro/realtime/upstream/urls";
import { DurableObject } from "cloudflare:workers";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { errorText, secretVariants } from "../collector/util";
import type { Env } from "../worker-env";
import { runnerPorts, SqlRecordStore, SqlRunnerStore } from "./cf-ports";
import {
	type ActiveSession,
	type InputResult,
	RunnerCore,
} from "./runner-core";

/** `tick`이 던졌을 때 다시 깨어나는 간격. */
const TICK_FAILURE_RETRY_MS = 60_000;
/** alarm을 너무 촘촘히 걸지 않는다. */
const MIN_ALARM_DELAY_MS = 1000;
const MAX_ID_LENGTH = 128;
const INPUT_KINDS: ReadonlySet<string> = new Set(["boarded", "next", "end"]);
const REPORT_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isId(value: unknown): value is string {
	return (
		typeof value === "string" && value !== "" && value.length <= MAX_ID_LENGTH
	);
}

function isSessionInput(value: unknown): value is SessionInput {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const { kind } = value as Record<string, unknown>;
	return typeof kind === "string" && INPUT_KINDS.has(kind);
}

/**
 * 출퇴근 세션 실행기 Durable Object(`commute-v1`). `fetch`는 쓰지 않고 RPC 메서드만 둔다.
 * alarm마다 `RunnerCore.tick`을 부르고 돌려받은 시각으로 다음 alarm을 건다(수집기와 같은 모양).
 * 처음 alarm은 cron의 `healthCheck`가 건다.
 */
export class CommuteRunner extends DurableObject<Env> {
	readonly #store: SqlRunnerStore;
	readonly #records: SqlRecordStore;
	readonly #log: (line: string) => void;
	#core: RunnerCore | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#store = new SqlRunnerStore(ctx.storage.sql);
		this.#records = new SqlRecordStore(ctx.storage.sql);
		const secrets = secretVariants([
			env.DATA_GO_KR_API_KEY ?? "",
			env.SEOUL_OPEN_API_KEY ?? "",
			env.APNS_KEY_P8 ?? "",
			env.FCM_SERVICE_ACCOUNT_JSON ?? "",
		]);
		this.#log = (line) => {
			console.log(redactKeys(line, secrets));
		};
	}

	/** cron(5분)용: alarm이 없으면 지금으로 건다. */
	async healthCheck(): Promise<void> {
		if ((await this.ctx.storage.getAlarm()) === null) {
			this.#log("commute runner alarm missing, arming");
			await this.ctx.storage.setAlarm(Date.now());
		}
	}

	async input(
		installId: string,
		sessionId: string,
		input: SessionInput
	): Promise<InputResult> {
		if (!(isId(installId) && isId(sessionId) && isSessionInput(input))) {
			throw new Error("input needs an install id, a session id and a kind");
		}
		return await this.#getCore().input(installId, sessionId, {
			kind: input.kind,
		});
	}

	async activeSession(installId: string): Promise<ActiveSession | null> {
		if (!isId(installId)) {
			throw new Error("activeSession needs an install id");
		}
		return await this.#getCore().activeSession(installId);
	}

	async ack(
		installId: string,
		sessionId: string,
		at: number
	): Promise<"ok" | "not-found"> {
		if (!(isId(installId) && isId(sessionId) && Number.isFinite(at))) {
			throw new Error("ack needs an install id, a session id and a time");
		}
		return await this.#getCore().ack(installId, sessionId, at);
	}

	/** cron용: 서비스일 하나의 일일 보고서를 쓴다(이미 썼으면 false). */
	async writeDailyReport(date: string): Promise<boolean> {
		if (typeof date !== "string" || !REPORT_DATE.test(date)) {
			throw new Error("writeDailyReport needs a YYYY-MM-DD date");
		}
		return await this.#getCore().writeDailyReport(date);
	}

	async alarm(): Promise<void> {
		let nextAlarmAt: number;
		try {
			({ nextAlarmAt } = await this.#getCore().tick());
		} catch (error) {
			this.#log(`commute tick failed: ${errorText(error)}`);
			nextAlarmAt = Date.now() + TICK_FAILURE_RETRY_MS;
		}
		await this.ctx.storage.setAlarm(
			Math.max(nextAlarmAt, Date.now() + MIN_ALARM_DELAY_MS)
		);
	}

	#getCore(): RunnerCore {
		if (this.#core === null) {
			const { mode, ports } = runnerPorts(
				this.env,
				{ records: this.#records, store: this.#store },
				this.#log
			);
			this.#log(
				`commute runner core push=${mode.push} upstream=${mode.upstream}`
			);
			this.#core = new RunnerCore(ports);
		}
		return this.#core;
	}
}

import { createAuth, parseOrigins } from "@Betro/auth";
import { DEFAULT_TIMEZONE } from "@Betro/commute/config";
import { createD1Db } from "@Betro/db";
import type {
	ExecutionContext,
	ScheduledController,
} from "@cloudflare/workers-types";
import type { Hono } from "hono";

import { createApp } from "./app";
import { upstreamFor } from "./collector/cf-ports";
import { collectorClient } from "./collector/client";
import { D1Timetable, runnerConfig } from "./commute/cf-ports";
import { commuteClient } from "./commute/client";
import { refreshHolidaysIfDue } from "./commute/holidays";
import { prunePushTokens, shouldPrune } from "./commute/push-token-prune";
import { commuteReportDate } from "./commute/runner-core";
import type { Env } from "./worker-env";

// biome-ignore lint/performance/noBarrelFile: wrangler는 Worker 진입점에서 Durable Object 클래스를 export해야 한다.
export { Collector } from "./collector/durable-object";
export { CommuteRunner } from "./commute/runner-do";
export type { Env } from "./worker-env";

/** 양의 정수 설정값. 없거나 잘못되면 undefined(기본값을 쓴다). */
function positiveInt(value: string | undefined): number | undefined {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

let cachedApp: Hono | undefined;

/** isolate당 한 번만 DB·인증·앱을 만든다. 수집기 스텁은 요청마다 새로 얻는다. */
function getApp(env: Env): Hono {
	if (!cachedApp) {
		const db = createD1Db(env.DB);
		const auth = createAuth(env, db);
		cachedApp = createApp({
			apiHost: env.API_HOST,
			auth,
			collector: collectorClient(env),
			commute: commuteClient(env),
			corsOrigins: parseOrigins(env.CORS_ORIGIN),
			db,
			mapWatchMaxPerInstall: positiveInt(env.MAP_WATCH_MAX_PER_INSTALL),
			mapWatchTtlMs: positiveInt(env.MAP_WATCH_TTL_MS),
			privacyContact: env.PRIVACY_CONTACT,
			stationView: {
				collector: collectorClient(env),
				config: runnerConfig(env),
				timetable: new D1Timetable(env.DB),
				timezone: DEFAULT_TIMEZONE,
			},
			statusHost: env.STATUS_HOST,
		});
	}
	return cachedApp;
}

/** 하루 한 번만 묵은 푸시 토큰을 지운다. 로그에는 지운 수만 남긴다. */
async function pruneTokensIfDue(env: Env, now: number): Promise<void> {
	if (!shouldPrune(now, DEFAULT_TIMEZONE)) {
		return;
	}
	const count = await prunePushTokens(createD1Db(env.DB), now);
	console.log(`push token prune: ${count}`);
}

export default {
	fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Response | Promise<Response> {
		return getApp(env).fetch(request, env, ctx);
	},
	/**
	 * cron(5분마다): 수집기 상태를 보고 알림을 판단한다. 시작한 수집기의 멈춘 alarm도 다시 건다.
	 * 출퇴근 실행기는 alarm이 없으면 건다(처음 배포 뒤 첫 alarm도 여기서 건다). 공휴일은
	 * 마지막 성공에서 24시간이 지났을 때만 받는다. 출퇴근 일일 보고서는 서비스일 다음 날 04:00부터
	 * 그날 것을 한 번 쓴다(실행기가 쓴 날짜를 기억한다). 묵은 푸시 토큰은 하루 한 번(04:00~04:05)
	 * 지운다. 하나가 실패해도 나머지는 돈다.
	 */
	async scheduled(
		_controller: ScheduledController,
		env: Env,
		_ctx: ExecutionContext
	): Promise<void> {
		const results = await Promise.allSettled([
			collectorClient(env).healthCheck(),
			commuteClient(env).healthCheck(),
			commuteClient(env).writeDailyReport(
				commuteReportDate(Date.now(), DEFAULT_TIMEZONE)
			),
			refreshHolidaysIfDue({
				db: createD1Db(env.DB),
				key: env.DATA_GO_KR_API_KEY ?? "",
				now: Date.now(),
				timezone: DEFAULT_TIMEZONE,
				upstream: upstreamFor(env),
			}),
			pruneTokensIfDue(env, Date.now()),
		]);
		for (const result of results) {
			if (result.status === "rejected") {
				throw result.reason;
			}
		}
	},
};

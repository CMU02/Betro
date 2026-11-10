import { createAuth, parseOrigins } from "@Betro/auth";
import { createD1Db } from "@Betro/db";
import type {
	ExecutionContext,
	ScheduledController,
} from "@cloudflare/workers-types";
import type { Hono } from "hono";

import { createApp } from "./app";
import { collectorClient } from "./collector/client";
import type { Env } from "./worker-env";

// biome-ignore lint/performance/noBarrelFile: wrangler는 Worker 진입점에서 Durable Object 클래스를 export해야 한다.
export { Collector } from "./collector/durable-object";
export type { Env } from "./worker-env";

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
			corsOrigins: parseOrigins(env.CORS_ORIGIN),
			db,
			statusHost: env.STATUS_HOST,
		});
	}
	return cachedApp;
}

export default {
	fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Response | Promise<Response> {
		return getApp(env).fetch(request, env, ctx);
	},
	/** cron(5분마다): 수집기 상태를 보고 알림을 판단한다. 시작한 수집기의 멈춘 alarm도 다시 건다. */
	async scheduled(
		_controller: ScheduledController,
		env: Env,
		_ctx: ExecutionContext
	): Promise<void> {
		await collectorClient(env).healthCheck();
	},
};

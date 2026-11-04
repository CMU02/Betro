import { createAuth, parseOrigins } from "@Betro/auth";
import { createD1Db } from "@Betro/db";
import type {
	D1Database,
	ExecutionContext,
	ScheduledController,
} from "@cloudflare/workers-types";
import type { Hono } from "hono";

import { createApp } from "./app";

/** Worker 바인딩·변수·secret. vars는 wrangler.jsonc, secret은 `wrangler secret`/`.dev.vars`. */
export interface Env {
	API_HOST: string;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	CORS_ORIGIN: string;
	DB: D1Database;
	STATUS_HOST: string;
}

let cachedApp: Hono | undefined;

/** isolate당 한 번만 DB·인증·앱을 만든다. */
function getApp(env: Env): Hono {
	if (!cachedApp) {
		const db = createD1Db(env.DB);
		const auth = createAuth(env, db);
		cachedApp = createApp({
			apiHost: env.API_HOST,
			auth,
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
	async scheduled(
		_controller: ScheduledController,
		_env: Env,
		_ctx: ExecutionContext
	): Promise<void> {
		// Task 12: 5분마다 수집기 healthCheck()를 부른다.
	},
};

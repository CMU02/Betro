import type { Context as ApiContext } from "@Betro/api/context";
import { appRouter } from "@Betro/api/routers/index";
import type { Auth } from "@Betro/auth";
import type { Database } from "@Betro/db";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getPath } from "hono/utils/url";

export type SnapshotKind = "subway" | "bus";

const SNAPSHOT_KINDS: readonly SnapshotKind[] = ["subway", "bus"];

/**
 * 수집기(Durable Object)에 닿는 클라이언트. Task 12가 DO 스텁으로 채운다.
 * 이 인터페이스는 앱 라우트가 쓰는 최소 메서드만 둔다.
 */
export interface CollectorClient {
	snapshot: (kind: SnapshotKind) => Promise<{ etag: string; body: string }>;
	status: () => Promise<unknown>;
}

export interface AppDeps {
	apiHost: string;
	auth: Auth;
	collector?: CollectorClient;
	corsOrigins: string[];
	db: Database;
	statusHost: string;
}

const CORS_MAX_AGE_SECONDS = 86_400;
const SNAPSHOT_MAX_AGE_SECONDS = 10;

/** 라우팅 접두사. 호스트로 API와 상태 페이지를 나눈다. */
const API_SCOPE = "/api-host";
const STATUS_SCOPE = "/status-host";

const PORT_SUFFIX = /:\d+$/;

function requestHostname(request: Request): string {
	const header = request.headers.get("host");
	if (header) {
		return header.replace(PORT_SUFFIX, "").toLowerCase();
	}
	return new URL(request.url).hostname.toLowerCase();
}

function isSnapshotKind(value: string): value is SnapshotKind {
	return (SNAPSHOT_KINDS as readonly string[]).includes(value);
}

function logError(error: unknown): void {
	console.error(error);
}

function createApiRoutes(deps: AppDeps): Hono {
	const { auth, db } = deps;

	const rpcHandler = new RPCHandler(appRouter, {
		interceptors: [onError(logError)],
	});

	const apiHandler = new OpenAPIHandler(appRouter, {
		interceptors: [onError(logError)],
		plugins: [
			new OpenAPIReferencePlugin({
				schemaConverters: [new ZodToJsonSchemaConverter()],
			}),
		],
	});

	const createContext = async (headers: Headers): Promise<ApiContext> => ({
		db,
		session: await auth.api.getSession({ headers }),
	});

	const routes = new Hono();

	routes.use(
		"*",
		cors({
			allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			credentials: true,
			maxAge: CORS_MAX_AGE_SECONDS,
			origin: deps.corsOrigins,
		})
	);

	routes.get("/", (c) => c.text("OK"));

	routes.all("/api/auth/*", (c) => auth.handler(c.req.raw));

	routes.all("/rpc/*", async (c) => {
		const { matched, response } = await rpcHandler.handle(c.req.raw, {
			context: await createContext(c.req.raw.headers),
			prefix: "/rpc",
		});
		return matched ? response : c.notFound();
	});

	routes.all("/api-reference/*", async (c) => {
		const { matched, response } = await apiHandler.handle(c.req.raw, {
			context: await createContext(c.req.raw.headers),
			prefix: "/api-reference",
		});
		return matched ? response : c.notFound();
	});

	routes.get("/v1/snapshot/:kind", async (c) => {
		const kind = c.req.param("kind");
		if (!isSnapshotKind(kind)) {
			return c.notFound();
		}
		if (!deps.collector) {
			return c.text("collector unavailable", 503);
		}
		const { etag, body } = await deps.collector.snapshot(kind);
		const quotedEtag = `"${etag}"`;
		const headers = {
			"Cache-Control": `public, max-age=${SNAPSHOT_MAX_AGE_SECONDS}`,
			ETag: quotedEtag,
		};
		if (c.req.header("if-none-match") === quotedEtag) {
			return c.body(null, 304, headers);
		}
		return c.body(body, 200, {
			...headers,
			"Content-Type": "application/json; charset=utf-8",
		});
	});

	return routes;
}

function createStatusRoutes(deps: AppDeps): Hono {
	const routes = new Hono();

	routes.get("/status.json", async (c) => {
		if (!deps.collector) {
			return c.text("collector unavailable", 503);
		}
		const status = await deps.collector.status();
		c.header("Cache-Control", "no-store");
		return c.json(status);
	});

	// Task 12가 renderStatusPage(status) HTML로 바꾼다.
	routes.get("/", async (c) => {
		if (!deps.collector) {
			return c.text("collector unavailable", 503);
		}
		const status = await deps.collector.status();
		c.header("Cache-Control", "no-store");
		return c.json(status);
	});

	return routes;
}

/**
 * API(`apiHost`)와 상태 페이지(`statusHost`)를 한 Worker에서 호스트로 나눠 받는다.
 * 상태 호스트가 아닌 요청(로컬 `wrangler dev`의 localhost 포함)은 API로 본다.
 */
export function createApp(deps: AppDeps): Hono {
	const statusHost = deps.statusHost.toLowerCase();

	const app = new Hono({
		getPath: (request) => {
			const scope =
				requestHostname(request) === statusHost ? STATUS_SCOPE : API_SCOPE;
			const path = getPath(request);
			// 루트("/")는 접두사만 남겨야 strict 라우팅에서 하위 앱의 "/"와 맞는다.
			return path === "/" ? scope : `${scope}${path}`;
		},
	});

	app.route(API_SCOPE, createApiRoutes(deps));
	app.route(STATUS_SCOPE, createStatusRoutes(deps));

	return app;
}

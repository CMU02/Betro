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
import type { CollectorClient } from "./collector/client";
import type { SnapshotKind } from "./collector/core";
import { INSTALL_HEADER } from "./commute/auth";
import type { CommuteRunnerClient } from "./commute/client";
import { createCommuteRoutes } from "./commute/routes";
import { createMapRoutes } from "./map/routes";
import type { StationViewDeps } from "./map/station-view";
import { renderPrivacyPage } from "./privacy-page";
import { ifNoneMatchMatches } from "./ref/if-none-match";
import { createRefRoutes } from "./ref/routes";
import { renderStatusPage } from "./status-page";

// biome-ignore lint/performance/noBarrelFile: 기존 테스트와 호출처가 app에서 가져온다.
export { ifNoneMatchMatches } from "./ref/if-none-match";

const SNAPSHOT_KINDS: readonly SnapshotKind[] = ["subway", "bus"];

export interface AppDeps {
	apiHost: string;
	auth: Auth;
	collector?: CollectorClient;
	commute?: CommuteRunnerClient;
	corsOrigins: string[];
	db: Database;
	/** 설치 하나가 한 번에 관측을 요청할 수 있는 버스 노선 수(`MAP_WATCH_MAX_PER_INSTALL`). */
	mapWatchMaxPerInstall?: number;
	/** 관측 요청 유지 시간 ms(`MAP_WATCH_TTL_MS`). */
	mapWatchTtlMs?: number;
	/** 개인정보 처리방침의 문의 연락처(`PRIVACY_CONTACT`). 비어 있으면 연락처 줄을 뺀다. */
	privacyContact?: string;
	/** 역 도착판(`POST /v1/map/station-view`)의 수집기·시간표·설정. 없으면 503이다. */
	stationView?: Omit<StationViewDeps, "watched">;
	statusHost: string;
}

const CORS_MAX_AGE_SECONDS = 86_400;
const SNAPSHOT_MAX_AGE_SECONDS = 10;
const DEFAULT_MAP_WATCH_TTL_MS = 90_000;
const DEFAULT_MAP_WATCH_MAX_PER_INSTALL = 6;

/** 라우팅 접두사. 호스트로 API와 상태 페이지를 나눈다. */
const API_SCOPE = "/api-host";
const STATUS_SCOPE = "/status-host";

/** 개인정보 처리방침을 마지막으로 고친 날. 내용을 고칠 때 함께 바꾼다. */
const PRIVACY_UPDATED_ON = "2026-11-24";

const PORT_SUFFIX = /:\d+$/;
/** 상태 페이지는 스크립트·외부 자원을 쓰지 않는다(인라인 스타일만). */
const STATUS_PAGE_CSP =
	"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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

	/** 개인정보 처리방침. 앱 설정 행이 이 주소를 연다. CORS가 필요 없어 미들웨어보다 앞에 둔다. */
	routes.get("/privacy", (c) =>
		c.html(
			renderPrivacyPage({
				contact: deps.privacyContact?.trim() || null,
				updatedOn: PRIVACY_UPDATED_ON,
			}),
			200,
			{ "Content-Security-Policy": STATUS_PAGE_CSP }
		)
	);

	routes.use(
		"*",
		cors({
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"X-Requested-With",
				INSTALL_HEADER,
			],
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
		if (ifNoneMatchMatches(c.req.header("if-none-match"), quotedEtag)) {
			return c.body(null, 304, headers);
		}
		return c.body(body, 200, {
			...headers,
			"Content-Type": "application/json; charset=utf-8",
		});
	});

	routes.route("/v1/ref", createRefRoutes(db));
	routes.route("/", createCommuteRoutes({ commute: deps.commute, db }));
	routes.route(
		"/",
		createMapRoutes({
			collector: deps.collector,
			commute: deps.commute,
			db,
			maxRoutesPerInstall:
				deps.mapWatchMaxPerInstall ?? DEFAULT_MAP_WATCH_MAX_PER_INSTALL,
			stationView: deps.stationView,
			watchTtlMs: deps.mapWatchTtlMs ?? DEFAULT_MAP_WATCH_TTL_MS,
		})
	);

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

	routes.get("/", async (c) => {
		if (!deps.collector) {
			return c.text("collector unavailable", 503);
		}
		const status = await deps.collector.status();
		return c.html(renderStatusPage(status), 200, {
			"Cache-Control": "no-store",
			"Content-Security-Policy": STATUS_PAGE_CSP,
		});
	});

	/** 수집 시작(한 번 수동으로 부른다). 이미 돌고 있으면 그대로 둔다. */
	routes.post("/internal/collector/start", async (c) => {
		if (!deps.collector) {
			return c.text("collector unavailable", 503);
		}
		const result = await deps.collector.start();
		c.header("Cache-Control", "no-store");
		return c.json(result);
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

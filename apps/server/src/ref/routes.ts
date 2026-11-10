import type { Database } from "@Betro/db";
import { Hono } from "hono";
import { currentBusBatch, findBusRouteStops, searchBusRoutes } from "./bus";
import { ifNoneMatchMatches } from "./if-none-match";

const CACHE_CONTROL = "public, max-age=3600";
const MAX_QUERY_LENGTH = 20;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DIGITS = /^\d+$/;

function parseLimit(raw: string | undefined): number | null {
	if (raw === undefined) {
		return DEFAULT_LIMIT;
	}
	if (!DIGITS.test(raw)) {
		return null;
	}
	const limit = Number(raw);
	return limit >= 1 && limit <= MAX_LIMIT ? limit : null;
}

/** 등록 화면용 조회 API(`/v1/ref`). 인증이 없는 공개 GET이다. */
export function createRefRoutes(db: Database): Hono {
	const routes = new Hono();

	/** 현재 배치로 ETag를 만들고 맞으면 304를 돌려줄 응답 머리. */
	const cacheHeaders = (batchId: number) => ({
		"Cache-Control": CACHE_CONTROL,
		ETag: `"bus-${batchId}"`,
	});

	routes.get("/bus/routes", async (c) => {
		const q = c.req.query("q")?.trim() ?? "";
		const limit = parseLimit(c.req.query("limit"));
		if (q.length < 1 || q.length > MAX_QUERY_LENGTH || limit === null) {
			return c.json({ error: "invalid query" }, 400);
		}
		const batchId = await currentBusBatch(db);
		if (batchId === null) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		const headers = cacheHeaders(batchId);
		if (ifNoneMatchMatches(c.req.header("if-none-match"), headers.ETag)) {
			return c.body(null, 304, headers);
		}
		const result = await searchBusRoutes(db, { limit, q });
		if (!result) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		return c.json(result, 200, headers);
	});

	routes.get("/bus/routes/:busRouteId/stops", async (c) => {
		const result = await findBusRouteStops(db, c.req.param("busRouteId"));
		if (!result) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		if (!result.route) {
			return c.json({ error: "route not found" }, 404);
		}
		const headers = cacheHeaders(result.batchId);
		if (ifNoneMatchMatches(c.req.header("if-none-match"), headers.ETag)) {
			return c.body(null, 304, headers);
		}
		return c.json(result.route, 200, headers);
	});

	return routes;
}

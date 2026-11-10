import type { Database } from "@Betro/db";
import { Hono } from "hono";
import { currentBusBatch, findBusRouteStops, searchBusRoutes } from "./bus";
import { stripBusPrefix, stripSubwayPrefix } from "./ids";
import { ifNoneMatchMatches } from "./if-none-match";
import {
	currentTrackBatch,
	findDirection,
	findLineKey,
	findLineStations,
	listSubwayLines,
} from "./subway";

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
		const result = await findBusRouteStops(
			db,
			stripBusPrefix(c.req.param("busRouteId"))
		);
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

	const subwayHeaders = (batchId: number) => ({
		"Cache-Control": CACHE_CONTROL,
		ETag: `"subway-${batchId}"`,
	});

	routes.get("/subway/lines", (c) =>
		c.json({ lines: listSubwayLines() }, 200, {
			"Cache-Control": CACHE_CONTROL,
		})
	);

	routes.get("/subway/lines/:lineKey/stations", async (c) => {
		const lineKey = findLineKey(stripSubwayPrefix(c.req.param("lineKey")));
		if (!lineKey) {
			return c.json({ error: "line not found" }, 404);
		}
		const batchId = await currentTrackBatch(db);
		if (batchId === null) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		const headers = subwayHeaders(batchId);
		if (ifNoneMatchMatches(c.req.header("if-none-match"), headers.ETag)) {
			return c.body(null, 304, headers);
		}
		const result = await findLineStations(db, lineKey);
		if (!result) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		return c.json(result, 200, headers);
	});

	routes.get("/subway/direction", async (c) => {
		const from = stripSubwayPrefix(c.req.query("from")?.trim() ?? "");
		const to = stripSubwayPrefix(c.req.query("to")?.trim() ?? "");
		if (from === "" || to === "" || from === to) {
			return c.json({ error: "invalid query" }, 400);
		}
		const lineKey = findLineKey(
			stripSubwayPrefix(c.req.query("line")?.trim() ?? "")
		);
		if (!lineKey) {
			return c.json({ error: "line not found" }, 404);
		}
		const found = await findDirection(db, lineKey, from, to);
		if (!found) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		if (!found.result) {
			return c.json({ error: "not-direct" }, 404);
		}
		return c.json(found.result, 200, subwayHeaders(found.batchId));
	});

	return routes;
}

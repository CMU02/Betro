import { createAuth } from "@Betro/auth";
import { createTestDb } from "@Betro/db/test-db";
import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../app";
import { OLD_ONLY_ROUTE_ID, seedBusReference } from "./test-seed";

const API_HOST = "betro.cmu02-studio.com";
const API = `https://${API_HOST}`;
const TEST_SECRET = "test-secret-test-secret-test-secret-0123";

type App = ReturnType<typeof createApp>;

function buildApp(db: Awaited<ReturnType<typeof createTestDb>>): App {
	return createApp({
		apiHost: API_HOST,
		auth: createAuth(
			{
				BETTER_AUTH_SECRET: TEST_SECRET,
				BETTER_AUTH_URL: API,
				CORS_ORIGIN: "http://localhost:8081",
			},
			db
		),
		corsOrigins: ["http://localhost:8081"],
		db,
		statusHost: "betro-status.cmu02-studio.com",
	});
}

let app: App;
let batchId: number;

beforeAll(async () => {
	const db = await createTestDb();
	({ currentBatchId: batchId } = await seedBusReference(db));
	app = buildApp(db);
});

const get = (path: string, headers: Record<string, string> = {}) =>
	app.request(`${API}/v1/ref${path}`, { headers });

describe("GET /v1/ref/bus/routes", () => {
	test("returns matches with cache headers and no auth", async () => {
		const res = await get("/bus/routes?q=1000");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		expect(res.headers.get("etag")).toBe(`"bus-${batchId}"`);
		const body = (await res.json()) as {
			batchId: number;
			routes: { region: string }[];
		};
		expect(body.batchId).toBe(batchId);
		expect(body.routes.map((route) => route.region)).toEqual([
			"seoul",
			"gyeonggi",
		]);
	});

	test("trims the query and defaults the limit to 20", async () => {
		const res = await get(`/bus/routes?q=${encodeURIComponent("  서초  ")}`);
		const body = (await res.json()) as { routes: { name: string }[] };
		expect(body.routes.map((route) => route.name)).toEqual(["서초03"]);
	});

	test("rejects a missing, blank or 21-character query", async () => {
		expect((await get("/bus/routes")).status).toBe(400);
		expect((await get("/bus/routes?q=%20%20")).status).toBe(400);
		expect((await get(`/bus/routes?q=${"1".repeat(21)}`)).status).toBe(400);
		expect((await get(`/bus/routes?q=${"1".repeat(20)}`)).status).toBe(200);
	});

	test("rejects a limit outside 1 to 50", async () => {
		expect((await get("/bus/routes?q=100&limit=0")).status).toBe(400);
		expect((await get("/bus/routes?q=100&limit=51")).status).toBe(400);
		expect((await get("/bus/routes?q=100&limit=abc")).status).toBe(400);
		const res = await get("/bus/routes?q=100&limit=1");
		const body = (await res.json()) as { routes: unknown[] };
		expect(body.routes).toHaveLength(1);
	});

	test("answers 304 when If-None-Match matches", async () => {
		const res = await get("/bus/routes?q=1000", {
			"if-none-match": `"bus-${batchId}"`,
		});
		expect(res.status).toBe(304);
		expect(res.headers.get("etag")).toBe(`"bus-${batchId}"`);
	});

	test("answers 503 when there is no current batch", async () => {
		const empty = buildApp(await createTestDb());
		const res = await empty.request(`${API}/v1/ref/bus/routes?q=100`);
		expect(res.status).toBe(503);
	});
});

describe("GET /v1/ref/bus/routes/:busRouteId/stops", () => {
	test("lists stops in order", async () => {
		const res = await get("/bus/routes/100100001/stops");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		expect(res.headers.get("etag")).toBe(`"bus-${batchId}"`);
		const body = (await res.json()) as {
			line: string;
			name: string;
			region: string;
			shortName: string;
			stops: { seq: number; stop: string }[];
		};
		expect(body.line).toBe("seoul-bus:100100001");
		expect(body.region).toBe("seoul");
		expect(body.stops.map((stop) => stop.seq)).toEqual([1, 2, 3]);
		expect(body.stops[0]?.stop).toBe("seoul-bus:S1");
	});

	test("accepts the line ID a search result returns", async () => {
		const search = await get("/bus/routes?q=1000");
		const { routes } = (await search.json()) as { routes: { line: string }[] };
		const line = routes[0]?.line;
		if (!line) {
			throw new Error("no search result");
		}
		expect(line.startsWith("seoul-bus:")).toBe(true);
		for (const id of [line, encodeURIComponent(line)]) {
			// biome-ignore lint/performance/noAwaitInLoops: 두 형태를 차례로 확인한다
			const res = await get(`/bus/routes/${id}/stops`);
			expect(res.status).toBe(200);
			expect(((await res.json()) as { line: string }).line).toBe(line);
		}
	});

	test("answers 404 for unknown and old-batch routes", async () => {
		expect((await get("/bus/routes/nope/stops")).status).toBe(404);
		expect((await get(`/bus/routes/${OLD_ONLY_ROUTE_ID}/stops`)).status).toBe(
			404
		);
	});

	test("answers 304 when If-None-Match matches", async () => {
		const res = await get("/bus/routes/100100001/stops", {
			"if-none-match": `"bus-${batchId}"`,
		});
		expect(res.status).toBe(304);
	});
});

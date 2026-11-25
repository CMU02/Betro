import { install } from "@Betro/db/schema/commute";
import { createTestDb } from "@Betro/db/test-db";
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { CollectorClient } from "../collector/client";
import { sha256Hex } from "../commute/auth";
import type { CommuteRunnerClient } from "../commute/client";
import { createMapRoutes } from "./routes";

const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const SECRET_A = "secret-a-secret-a-secret-a-secret-a-0001";
const BASE = "https://betro.test";
const TTL_MS = 90_000;
const MAX_ROUTES = 6;
const TOO_MANY = 7;

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let db: TestDb;
let app: Hono;
let nowMs = Date.UTC(2026, 10, 20, 0, 0, 0);
let watchCalls: [string, string[], number][] = [];
let routeViewCalls = 0;

const fakeCollector = {
	watchBusRoutes: (installId: string, routeIds: string[], until: number) => {
		watchCalls.push([installId, routeIds, until]);
		return Promise.resolve();
	},
} as unknown as CollectorClient;

const fakeCommute = {
	routeView: () => {
		routeViewCalls += 1;
		return Promise.resolve({ destinationEtaAt: 123, legs: [] });
	},
} as unknown as CommuteRunnerClient;

const validRoute = {
	legs: [
		{
			alight: { name: "나", seq: 20, stop: "seoul-bus:119000022" },
			board: { name: "가", seq: 3, stop: "seoul-bus:119000011" },
			line: "seoul-bus:100100290",
			lineName: "6411",
			mode: "bus",
		},
	],
	rank: 0,
	walkMinutes: [5, 3],
};

beforeEach(async () => {
	db = await createTestDb();
	nowMs = Date.UTC(2026, 10, 20, 0, 0, 0);
	watchCalls = [];
	routeViewCalls = 0;
	await db.insert(install).values({
		createdAt: nowMs,
		id: INSTALL_A,
		lastSeenAt: nowMs,
		platform: "ios",
		secretHash: await sha256Hex(SECRET_A),
	});
	app = new Hono();
	app.route(
		"/",
		createMapRoutes({
			collector: fakeCollector,
			commute: fakeCommute,
			db,
			maxRoutesPerInstall: MAX_ROUTES,
			now: () => nowMs,
			watchTtlMs: TTL_MS,
		})
	);
});

function post(path: string, body: unknown, auth = true) {
	return app.request(`${BASE}${path}`, {
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			...(auth
				? {
						Authorization: `Bearer ${SECRET_A}`,
						"X-Betro-Install": INSTALL_A,
					}
				: {}),
		},
		method: "POST",
	});
}

describe("POST /v1/map/watch", () => {
	test("401 without install auth", async () => {
		const res = await post("/v1/map/watch", { busRoutes: [] }, false);
		expect(res.status).toBe(401);
		expect(watchCalls).toHaveLength(0);
	});

	test("400 too-many-routes for 7 bus routes and does not call the collector", async () => {
		const busRoutes = Array.from(
			{ length: TOO_MANY },
			(_, i) => `seoul-bus:10010${i}`
		);
		const res = await post("/v1/map/watch", { busRoutes });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "too-many-routes" });
		expect(watchCalls).toHaveLength(0);
	});

	test("ignores non-bus refs and forwards ids without prefix with until = now + ttl", async () => {
		const res = await post("/v1/map/watch", {
			busRoutes: ["seoul-bus:100100290", "seoul-subway:1002", "seoul-bus:5"],
		});
		expect(res.status).toBe(204);
		expect(watchCalls).toEqual([
			[INSTALL_A, ["100100290", "5"], nowMs + TTL_MS],
		]);
	});

	test("400 on a malformed body", async () => {
		const res = await post("/v1/map/watch", { nope: 1 });
		expect(res.status).toBe(400);
	});
});

describe("POST /v1/map/route-view", () => {
	test("401 without install auth", async () => {
		const res = await post("/v1/map/route-view", { route: validRoute }, false);
		expect(res.status).toBe(401);
		expect(routeViewCalls).toBe(0);
	});

	test("400 on invalid route, 200 with RouteView on valid", async () => {
		const bad = await post("/v1/map/route-view", { route: { legs: [] } });
		expect(bad.status).toBe(400);
		const ok = await post("/v1/map/route-view", { route: validRoute });
		expect(ok.status).toBe(200);
		expect(ok.headers.get("Cache-Control")).toBe("no-store");
		expect(await ok.json()).toEqual({ destinationEtaAt: 123, legs: [] });
	});
});

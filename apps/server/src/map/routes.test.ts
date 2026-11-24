import { install } from "@Betro/db/schema/commute";
import { createTestDb } from "@Betro/db/test-db";
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { CollectorClient } from "../collector/client";
import { sha256Hex } from "../commute/auth";
import type { CommuteRunnerClient } from "../commute/client";
import {
	GBIS_COLLIDING_ROUTE_ID,
	GBIS_ROUTE_ID,
	OLD_ONLY_ROUTE_ID,
	seedBusReference,
} from "../ref/test-seed";
import { createMapRoutes } from "./routes";
import type { StationTimetable } from "./station-view";

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
let busRouteViewCalls: string[] = [];
let stationWatchCalls = 0;
let stationCollectorFails = false;

const fakeCollector = {
	watchBusRoutes: (installId: string, routeIds: string[], until: number) => {
		watchCalls.push([installId, routeIds, until]);
		return Promise.resolve();
	},
} as unknown as CollectorClient;

const busRouteViewStub = {
	etaState: "live",
	fetchedAt: 1,
	headwayMs: 480_000,
	stops: [{ seq: 1, vehicles: [] }],
} as const;

const fakeCommute = {
	busRouteView: (line: string) => {
		busRouteViewCalls.push(line);
		return Promise.resolve(busRouteViewStub);
	},
	routeView: () => {
		routeViewCalls += 1;
		return Promise.resolve({ destinationEtaAt: 123, legs: [] });
	},
} as unknown as CommuteRunnerClient;

/** 역 도착용 수집기. `stationCollectorFails`이면 두 메서드 모두 throw한다. */
const fakeStationCollector = {
	stationRows: () =>
		stationCollectorFails
			? Promise.reject(new Error("collector down"))
			: Promise.resolve({}),
	watchStations: () => {
		stationWatchCalls += 1;
		return stationCollectorFails
			? Promise.reject(new Error("collector down"))
			: Promise.resolve();
	},
};

const fakeTimetable: StationTimetable = {
	firstLast: () => Promise.resolve({ firstAt: null, lastAt: null }),
	nextArrivals: (_line, _direction, _statnId, fromMs) =>
		Promise.resolve(
			[1, 2, 3, 4].map((minute) => ({
				at: fromMs + minute * 60_000,
				tripId: minute,
			}))
		),
	rideMs: () => Promise.resolve(null),
};

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
	busRouteViewCalls = [];
	stationWatchCalls = 0;
	stationCollectorFails = false;
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
			stationView: {
				collector: fakeStationCollector,
				config: { staleAfterMs: 150_000, subwayEtaBiasSec: {} },
				timetable: fakeTimetable,
				timezone: "test/zone",
			},
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

	test("watch는 gbis·tago 참조를 출처 키로 수집기에 넘긴다", async () => {
		const res = await post("/v1/map/watch", {
			busRoutes: ["seoul-bus:100100290", "gbis:100100290", "tago:ICB361000005"],
		});
		expect(res.status).toBe(204);
		expect(watchCalls).toEqual([
			[
				INSTALL_A,
				["100100290", "gbis:100100290", "tago:ICB361000005"],
				nowMs + TTL_MS,
			],
		]);
	});

	test("400 for a malformed gbis or tago ref", async () => {
		const statuses = await Promise.all(
			["gbis:abc", "tago:123", "tago:icb1"].map(
				async (ref) =>
					(await post("/v1/map/watch", { busRoutes: [ref] })).status
			)
		);
		expect(statuses).toEqual([400, 400, 400]);
		expect(watchCalls).toHaveLength(0);
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

describe("POST /v1/map/station-view", () => {
	const station = {
		line: "seoul-subway:line2",
		stop: "seoul-subway:1002000222",
	};

	test("seoul-subway가 아닌 stop, 모르는 노선, 7개 이상은 400이고 인증이 없으면 401이다", async () => {
		const unauth = await post(
			"/v1/map/station-view",
			{ stations: [station] },
			false
		);
		expect(unauth.status).toBe(401);
		const bodies = [
			{ stations: [{ ...station, stop: "seoul-bus:1002000222" }] },
			{ stations: [{ ...station, stop: "seoul-subway:abc" }] },
			{ stations: [{ ...station, line: "seoul-subway:line99" }] },
			{ stations: [{ ...station, line: "seoul-bus:line2" }] },
			{ stations: [{ ...station, line: "line2" }] },
			{ stations: Array.from({ length: TOO_MANY }, () => station) },
			{ stations: [] },
			{ stations: [{ ...station, name: "강남" }] },
			{ extra: 1, stations: [station] },
		];
		const statuses = await Promise.all(
			bodies.map(
				async (body) => (await post("/v1/map/station-view", body)).status
			)
		);
		expect(statuses).toEqual(bodies.map(() => 400));
		expect(stationWatchCalls).toBe(0);
	});

	test("수집기가 throw해도 시간표로 200이다", async () => {
		stationCollectorFails = true;
		const res = await post("/v1/map/station-view", { stations: [station] });
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		const body = (await res.json()) as {
			stations: {
				directions: { approaching: unknown[]; etaState: string }[];
				line: string;
				stop: string;
			}[];
			timezone: string;
		};
		expect(body.timezone).toBe("test/zone");
		expect(body.stations[0]).toMatchObject(station);
		expect(
			body.stations[0]?.directions.map((d) => [
				d.etaState,
				d.approaching.length,
			])
		).toEqual([
			["estimated", 3],
			["estimated", 3],
		]);
	});

	test("역 도착 의존성이 없으면 503이다", async () => {
		const bare = new Hono();
		bare.route(
			"/",
			createMapRoutes({
				db,
				maxRoutesPerInstall: MAX_ROUTES,
				now: () => nowMs,
				watchTtlMs: TTL_MS,
			})
		);
		const res = await bare.request(`${BASE}/v1/map/station-view`, {
			body: JSON.stringify({ stations: [station] }),
			headers: {
				Authorization: `Bearer ${SECRET_A}`,
				"Content-Type": "application/json",
				"X-Betro-Install": INSTALL_A,
			},
			method: "POST",
		});
		expect(res.status).toBe(503);
	});
});

describe("POST /v1/map/bus-route-view", () => {
	test("gbis 노선과 서울 출처 경기 면허 노선(routeType 8)은 400이고 실행기를 부르지 않는다", async () => {
		await seedBusReference(db);
		const unauth = await post(
			"/v1/map/bus-route-view",
			{ line: "seoul-bus:100100001" },
			false
		);
		expect(unauth.status).toBe(401);
		const bodies = [
			{ line: `gbis:${GBIS_ROUTE_ID}` },
			{ line: "seoul-bus:200000001" },
			{ line: "seoul-bus:234001243" },
			{ line: `seoul-bus:${OLD_ONLY_ROUTE_ID}` },
			{ line: "seoul-bus:404404404" },
			{ line: "seoul-bus:abc" },
			{ line: "100100001" },
			{ extra: 1, line: "seoul-bus:100100001" },
			{},
		];
		const statuses = await Promise.all(
			bodies.map(
				async (body) => (await post("/v1/map/bus-route-view", body)).status
			)
		);
		expect(statuses).toEqual(bodies.map(() => 400));
		expect(busRouteViewCalls).toEqual([]);
	});

	test("응답에 노선 번호·이름·routeType이 붙는다", async () => {
		await seedBusReference(db);
		// 서초03은 gbis 노선과 routeId가 같다. 서울 노선을 골라야 한다.
		const res = await post("/v1/map/bus-route-view", {
			line: `seoul-bus:${GBIS_COLLIDING_ROUTE_ID}`,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(await res.json()).toEqual({
			...busRouteViewStub,
			route: { name: "서초03", routeType: "2", shortName: "서초03" },
		});
		expect(busRouteViewCalls).toEqual([`seoul-bus:${GBIS_COLLIDING_ROUTE_ID}`]);
	});

	test("현재 버스 배치가 없으면 503이고 실행기를 부르지 않는다", async () => {
		const res = await post("/v1/map/bus-route-view", {
			line: "seoul-bus:100100001",
		});
		expect(res.status).toBe(503);
		expect(busRouteViewCalls).toEqual([]);
	});
});

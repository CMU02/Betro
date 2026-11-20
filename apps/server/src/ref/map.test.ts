import { createAuth } from "@Betro/auth";
import type { LibsqlDatabase } from "@Betro/db";
import {
	busRoute,
	busRouteShape,
	busRouteStop,
	referenceBatch,
	stationCrosswalk,
	timetableStopTime,
	timetableTrip,
	trackShape,
	trackStation,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../app";

const API_HOST = "betro.cmu02-studio.com";
const API = `https://${API_HOST}`;
const TEST_SECRET = "test-secret-test-secret-test-secret-0123";
const CACHE_CONTROL = "public, max-age=86400";

const ROUTE_ID = "100100001";
const STATION_IDS = ["7001", "7002", "7003", "7004"];
const SHAPE_COORDS: [number, number][] = [
	[127, 37.5],
	[127.02, 37.5],
	[127.04, 37.5],
	[127.06, 37.5],
];

let db: LibsqlDatabase;
let app: ReturnType<typeof createApp>;
let busBatchId: number;
let trackBatchId: number;
let crosswalkBatchId: number;

function buildApp(testDb: LibsqlDatabase) {
	return createApp({
		apiHost: API_HOST,
		auth: createAuth(
			{
				BETTER_AUTH_SECRET: TEST_SECRET,
				BETTER_AUTH_URL: API,
				CORS_ORIGIN: "http://localhost:8081",
			},
			testDb
		),
		corsOrigins: ["http://localhost:8081"],
		db: testDb,
		statusHost: "betro-status.cmu02-studio.com",
	});
}

async function seedBus(): Promise<void> {
	const [batch] = await db
		.insert(referenceBatch)
		.values({ isCurrent: true, kind: "bus_route", sourceManifest: {} })
		.returning({ id: referenceBatch.id });
	if (!batch) {
		throw new Error("seed batch missing");
	}
	busBatchId = batch.id;
	const [route] = await db
		.insert(busRoute)
		.values({
			batchId: batch.id,
			qualityFlags: [],
			region: "seoul",
			routeId: ROUTE_ID,
			routeName: "100",
			routeType: "3",
			shortName: "100",
		})
		.returning({ id: busRoute.id });
	if (!route) {
		throw new Error("seed route missing");
	}
	await db.insert(busRouteShape).values({
		attribution: "test",
		busRouteId: route.id,
		coords: SHAPE_COORDS,
		lengthM: 6000,
	});
	await db.insert(busRouteStop).values(
		[
			{ arsId: "01002", name: "둘째", seq: 2, stationId: "S2" },
			{ arsId: null, name: "첫째", seq: 1, stationId: "S1" },
		].map((stop) => ({
			...stop,
			apiSectDistM: 0,
			busRouteId: route.id,
			distanceM: 0,
			lat: 37.5,
			lng: 127 + 0.01 * (stop.seq - 1),
			offsetM: 0,
			qualityFlags: [],
		}))
	);
}

async function seedSubway(): Promise<void> {
	const [crosswalk, track, timetable] = await db
		.insert(referenceBatch)
		.values([
			{ isCurrent: true, kind: "station_crosswalk", sourceManifest: {} },
			{ isCurrent: true, kind: "track", sourceManifest: {} },
			{ isCurrent: true, kind: "timetable", sourceManifest: {} },
		])
		.returning({ id: referenceBatch.id });
	if (!(crosswalk && track && timetable)) {
		throw new Error("seed batches missing");
	}
	crosswalkBatchId = crosswalk.id;
	trackBatchId = track.id;
	await db.insert(stationCrosswalk).values(
		STATION_IDS.map((statnId, i) => ({
			batchId: crosswalk.id,
			coordSource: "test",
			lat: 37.5,
			lineKey: "line7",
			lng: 127 + 0.02 * i,
			matchMethod: "auto-same-line" as const,
			nameAliases: [],
			nameCanonical: `칠${i + 1}`,
			qualityFlags: [],
			statnId,
			subwayId: "1007",
		}))
	);
	await Promise.all(
		(["up", "down"] as const).map(async (direction, relationId) => {
			const ids =
				direction === "down" ? STATION_IDS : [...STATION_IDS].reverse();
			const [shape] = await db
				.insert(trackShape)
				.values({
					attribution: "test",
					batchId: track.id,
					branchKey: "main",
					coords:
						direction === "down" ? SHAPE_COORDS : [...SHAPE_COORDS].reverse(),
					direction,
					lengthM: 6000,
					lineKey: "line7",
					osmRelationId: relationId + 1,
				})
				.returning({ id: trackShape.id });
			if (!shape) {
				throw new Error("seed shape missing");
			}
			await db.insert(trackStation).values(
				ids.map((statnId, seq) => ({
					anchor: "osm-stop" as const,
					distanceM: seq * 2000,
					offsetM: seq * 2000,
					seq,
					statnId,
					trackShapeId: shape.id,
				}))
			);
		})
	);
	await seedTrips(timetable.id);
}

/** 7001 → 7002 소요 100·120·200초(평일 3대), 급행 하나는 7002를 건너뛰고, 토요일 하나는 999초. */
async function seedTrips(batchId: number): Promise<void> {
	const trips: {
		day: "weekday" | "saturday";
		no: string;
		stops: [string, number, number][];
	}[] = [
		{
			day: "weekday",
			no: "1",
			stops: [
				["7001", 0, 0],
				["7002", 100, 110],
				["7003", 300, 310],
			],
		},
		{
			day: "weekday",
			no: "2",
			stops: [
				["7001", 1000, 1000],
				["7002", 1120, 1130],
				["7003", 1300, 1310],
			],
		},
		{
			day: "weekday",
			no: "3",
			stops: [
				["7001", 2000, 2000],
				["7002", 2200, 2210],
				["7003", 2400, 2410],
			],
		},
		{
			day: "weekday",
			no: "4",
			stops: [
				["7001", 3000, 3000],
				["7003", 3200, 3210],
			],
		},
		{
			day: "saturday",
			no: "5",
			stops: [
				["7001", 0, 0],
				["7002", 999, 1000],
			],
		},
	];
	await Promise.all(
		trips.map(async (trip) => {
			const [row] = await db
				.insert(timetableTrip)
				.values({
					batchId,
					direction: "down",
					express: "local",
					lineKey: "line7",
					qualityFlags: [],
					serviceDay: trip.day,
					serviceDaySource: "source",
					source: "seoul-metro-csv",
					sourceVersion: "test",
					trainNo: trip.no,
				})
				.returning({ id: timetableTrip.id });
			if (!row) {
				throw new Error("seed trip missing");
			}
			await db.insert(timetableStopTime).values(
				trip.stops.map(([statnId, arriveSec, departSec], seq) => ({
					arriveSec,
					departSec,
					qualityFlags: [],
					seq,
					statnId,
					tripId: row.id,
				}))
			);
		})
	);
}

beforeAll(async () => {
	db = await createTestDb();
	await seedBus();
	await seedSubway();
	app = buildApp(db);
});

const get = (path: string, headers?: Record<string, string>) =>
	app.request(`${API}/v1/ref/map${path}`, { headers });

describe("bus map", () => {
	test("bus map returns shape and stops with coordinates in seq order and a batch etag", async () => {
		const res = await get(`/bus/seoul-bus:${ROUTE_ID}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
		expect(res.headers.get("etag")).toBe(`"busmap-${busBatchId}"`);
		expect(await res.json()).toEqual({
			batchId: busBatchId,
			line: `seoul-bus:${ROUTE_ID}`,
			shape: SHAPE_COORDS,
			stops: [
				{
					arsId: null,
					lat: 37.5,
					lng: 127,
					name: "첫째",
					seq: 1,
					stop: "seoul-bus:S1",
				},
				{
					arsId: "01002",
					lat: 37.5,
					lng: 127.01,
					name: "둘째",
					seq: 2,
					stop: "seoul-bus:S2",
				},
			],
		});
	});

	test("bus map 404 for unknown route", async () => {
		const res = await get("/bus/seoul-bus:nope");
		expect(res.status).toBe(404);
	});

	test("304 when If-None-Match matches", async () => {
		const res = await get(`/bus/${ROUTE_ID}`, {
			"If-None-Match": `"busmap-${busBatchId}"`,
		});
		expect(res.status).toBe(304);
		expect(res.headers.get("etag")).toBe(`"busmap-${busBatchId}"`);
	});
});

describe("subway map", () => {
	test("subway map returns branches with shape and ordered stations", async () => {
		const res = await get("/subway/seoul-subway:line7");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
		const body = (await res.json()) as {
			batchId: number;
			line: string;
			branches: {
				branchKey: string;
				direction: string;
				shape: [number, number][];
				stations: {
					name: string;
					offsetM: number;
					seq: number;
					stop: string;
				}[];
			}[];
		};
		expect(body.batchId).toBe(trackBatchId);
		expect(body.line).toBe("seoul-subway:line7");
		expect(
			body.branches.map((b) => `${b.branchKey}:${b.direction}`).sort()
		).toEqual(["main:down", "main:up"]);
		const down = body.branches.find((b) => b.direction === "down");
		expect(down?.shape).toEqual(SHAPE_COORDS);
		expect(down?.stations.map((s) => s.stop)).toEqual(
			STATION_IDS.map((id) => `seoul-subway:${id}`)
		);
		expect(down?.stations.map((s) => s.seq)).toEqual([0, 1, 2, 3]);
		expect(down?.stations.map((s) => s.offsetM)).toEqual([0, 2000, 4000, 6000]);
		expect(down?.stations[0]).toMatchObject({
			lat: 37.5,
			lng: 127,
			name: "칠1",
		});
	});

	test("subway map gives nextRunSec as the median weekday run time to the next station, null at the terminal", async () => {
		const res = await get("/subway/line7");
		const body = (await res.json()) as {
			branches: {
				direction: string;
				stations: { nextRunSec: number | null; stop: string }[];
			}[];
		};
		const down = body.branches.find((b) => b.direction === "down");
		const run = (id: string) =>
			down?.stations.find((s) => s.stop === `seoul-subway:${id}`)?.nextRunSec;
		// 7001 -> 7002: 100, 120, 200 중앙값. 급행(7002 건너뜀)과 토요일은 빠진다.
		expect(run("7001")).toBe(120);
		// 7002 -> 7003: 출발 110/1130/2210, 도착 300/1300/2400 -> 190, 170, 190
		expect(run("7002")).toBe(190);
		expect(run("7003")).toBeNull();
		expect(run("7004")).toBeNull();
	});

	test("subway map 404 for unknown line", async () => {
		expect((await get("/subway/nope")).status).toBe(404);
	});

	test("304 when If-None-Match matches", async () => {
		const first = await get("/subway/line7");
		const etag = first.headers.get("etag") ?? "";
		expect(etag).toContain(`${trackBatchId}`);
		const second = await get("/subway/line7", { "If-None-Match": etag });
		expect(second.status).toBe(304);
	});
});

describe("subway stations", () => {
	test("subway-stations lists every station with line and coordinates", async () => {
		const res = await get("/subway-stations");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
		const body = (await res.json()) as {
			batchId: number;
			stations: {
				lat: number;
				line: string;
				lng: number;
				name: string;
				stop: string;
			}[];
		};
		expect(body.batchId).toBe(crosswalkBatchId);
		expect(body.stations).toHaveLength(STATION_IDS.length);
		expect(body.stations[0]).toEqual({
			lat: 37.5,
			line: "seoul-subway:line7",
			lng: 127,
			name: "칠1",
			stop: "seoul-subway:7001",
		});
	});

	test("304 when If-None-Match matches", async () => {
		const etag = `"substations-${crosswalkBatchId}"`;
		const res = await get("/subway-stations", { "If-None-Match": etag });
		expect(res.status).toBe(304);
	});
});

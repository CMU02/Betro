import { createAuth } from "@Betro/auth";
import type { LibsqlDatabase } from "@Betro/db";
import {
	referenceBatch,
	stationCrosswalk,
	trackShape,
	trackStation,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { LINES } from "@Betro/transit-static/lines";
import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../app";
import { directionBetween, isLoopShape } from "./subway";

const API_HOST = "betro.cmu02-studio.com";
const API = `https://${API_HOST}`;
const TEST_SECRET = "test-secret-test-secret-test-secret-0123";

type Shape = Parameters<typeof directionBetween>[0][number];

const straightShapes: Shape[] = [
	{ direction: "down", isLoop: false, stations: ["A", "B", "C", "D"] },
	{ direction: "up", isLoop: false, stations: ["D", "C", "B", "A"] },
];

const ring = ["L1", "L2", "L3", "L4", "L5", "L6"];
const loopShapes: Shape[] = [
	{ direction: "up", isLoop: true, stations: ring },
	{ direction: "down", isLoop: true, stations: [...ring].reverse() },
];

describe("directionBetween", () => {
	test("picks the shape on which from comes before to", () => {
		expect(directionBetween(straightShapes, "A", "C")).toEqual({
			direction: "down",
			stops: 2,
		});
		expect(directionBetween(straightShapes, "C", "A")).toEqual({
			direction: "up",
			stops: 2,
		});
	});

	test("wraps over the seam of a loop and prefers the shorter way", () => {
		expect(directionBetween(loopShapes, "L6", "L1")).toEqual({
			direction: "up",
			stops: 1,
		});
		expect(directionBetween(loopShapes, "L1", "L6")).toEqual({
			direction: "down",
			stops: 1,
		});
		expect(directionBetween(loopShapes, "L2", "L5")).toEqual({
			direction: "up",
			stops: 3,
		});
	});

	test("does not wrap a straight shape", () => {
		expect(directionBetween(straightShapes, "D", "A")).toEqual({
			direction: "up",
			stops: 3,
		});
	});

	test("returns null when the stations share no shape", () => {
		const shapes: Shape[] = [
			{ direction: "down", isLoop: false, stations: ["M1", "M2", "M3"] },
			{ direction: "down", isLoop: false, stations: ["M2", "B1", "B2"] },
		];
		expect(directionBetween(shapes, "M3", "B2")).toBeNull();
		expect(directionBetween(shapes, "M1", "B2")).toBeNull();
		expect(directionBetween(shapes, "M2", "B2")).toEqual({
			direction: "down",
			stops: 2,
		});
	});

	test("returns null for an unknown station", () => {
		expect(directionBetween(straightShapes, "A", "Z")).toBeNull();
	});

	test("takes the smallest stop count when several shapes match", () => {
		const shapes: Shape[] = [
			{ direction: "down", isLoop: false, stations: ["A", "B", "C", "D"] },
			{ direction: "up", isLoop: false, stations: ["A", "D"] },
		];
		expect(directionBetween(shapes, "A", "D")).toEqual({
			direction: "up",
			stops: 1,
		});
	});
});

describe("isLoopShape", () => {
	const at = (lat: number, lng: number) => ({ lat, lng });
	const hexagon = [
		at(37.52, 127),
		at(37.51, 127.017),
		at(37.49, 127.017),
		at(37.48, 127),
		at(37.49, 126.983),
		at(37.51, 126.983),
	];

	test("is true when the ends are as close as neighbours", () => {
		expect(isLoopShape(hexagon, 2000)).toBe(true);
	});

	test("is false when the ends are farther than any gap", () => {
		const open = [at(37.5, 127), at(37.5, 127.02), at(37.5, 127.04)];
		expect(isLoopShape(open, 2000)).toBe(false);
	});

	test("is false when a station has no coordinate", () => {
		expect(isLoopShape([null, ...hexagon.slice(1)], 2000)).toBe(false);
	});
});

function buildApp(db: LibsqlDatabase) {
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

const HEX_COORDS: [number, number][] = [
	[37.52, 127],
	[37.51, 127.017],
	[37.49, 127.017],
	[37.48, 127],
	[37.49, 126.983],
	[37.51, 126.983],
];
const LOOP_IDS = HEX_COORDS.map((_, i) => `2000${i + 1}`);
/** 신도림 같은 환승역: 본선 두 번째 역이 지선의 첫 역이다. */
const BRANCH_IDS = ["20002", "21001", "21002", "21003"];
const STRAIGHT_IDS = ["7001", "7002", "7003", "7004"];

async function seedSubway(
	db: LibsqlDatabase
): Promise<{ trackBatchId: number }> {
	const [crosswalkBatch, , trackBatch] = await db
		.insert(referenceBatch)
		.values([
			{ isCurrent: true, kind: "station_crosswalk", sourceManifest: {} },
			{ isCurrent: false, kind: "track", sourceManifest: {} },
			{ isCurrent: true, kind: "track", sourceManifest: {} },
		])
		.returning({ id: referenceBatch.id });
	if (!(crosswalkBatch && trackBatch)) {
		throw new Error("seed batches missing");
	}
	const station = (
		statnId: string,
		name: string,
		lineKey: string,
		lat: number,
		lng: number
	) => ({
		batchId: crosswalkBatch.id,
		coordSource: "test",
		lat,
		lineKey,
		lng,
		matchMethod: "auto-same-line" as const,
		nameAliases: [],
		nameCanonical: name,
		qualityFlags: [],
		statnId,
		subwayId: "1000",
	});
	await db.insert(stationCrosswalk).values([
		...LOOP_IDS.map((id, i) => {
			const [lat, lng] = HEX_COORDS[i] ?? [0, 0];
			return station(id, `순환${i + 1}`, "line2", lat, lng);
		}),
		...BRANCH_IDS.slice(1).map((id, i) =>
			station(id, `지선${i + 1}`, "line2", 37.5 - 0.03 * (i + 1), 127.017)
		),
		...STRAIGHT_IDS.map((id, i) =>
			station(id, `칠${i + 1}`, "line7", 37.5, 127 + 0.02 * i)
		),
	]);

	const relation = { next: 1 };
	const addShape = async (
		lineKey: string,
		branchKey: string,
		direction: "up" | "down",
		statnIds: readonly string[]
	) => {
		const [shape] = await db
			.insert(trackShape)
			.values({
				attribution: "test",
				batchId: trackBatch.id,
				branchKey,
				coords: [],
				direction,
				lengthM: 1000,
				lineKey,
				osmRelationId: relation.next,
			})
			.returning({ id: trackShape.id });
		relation.next += 1;
		if (!shape) {
			throw new Error("seed shape missing");
		}
		await db.insert(trackStation).values(
			statnIds.map((statnId, seq) => ({
				anchor: "osm-stop" as const,
				distanceM: seq * 1000,
				offsetM: 0,
				seq,
				statnId,
				trackShapeId: shape.id,
			}))
		);
	};
	await addShape("line2", "main", "up", LOOP_IDS);
	await addShape("line2", "main", "down", [...LOOP_IDS].reverse());
	await addShape("line2", "sinjeong", "up", BRANCH_IDS);
	await addShape("line2", "sinjeong", "down", [...BRANCH_IDS].reverse());
	await addShape("line7", "main", "up", STRAIGHT_IDS);
	await addShape("line7", "main", "down", [...STRAIGHT_IDS].reverse());
	return { trackBatchId: trackBatch.id };
}

let app: ReturnType<typeof buildApp>;
let emptyApp: ReturnType<typeof buildApp>;
let trackBatchId: number;

beforeAll(async () => {
	const db = await createTestDb();
	({ trackBatchId } = await seedSubway(db));
	app = buildApp(db);
	emptyApp = buildApp(await createTestDb());
});

const get = (path: string, headers: Record<string, string> = {}) =>
	app.request(`${API}/v1/ref/subway${path}`, { headers });

describe("GET /v1/ref/subway/lines", () => {
	test("lists every line in LINES order with cache headers", async () => {
		const res = await get("/lines");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		const body = (await res.json()) as {
			lines: { line: string; name: string }[];
		};
		expect(body.lines).toHaveLength(LINES.length);
		expect(body.lines[0]).toEqual({
			line: "seoul-subway:line1",
			name: "1호선",
		});
		expect(body.lines.map((line) => line.line)).toEqual(
			LINES.map((line) => `seoul-subway:${line.lineKey}`)
		);
	});

	test("works without any reference data", async () => {
		const res = await emptyApp.request(`${API}/v1/ref/subway/lines`);
		expect(res.status).toBe(200);
	});
});

describe("GET /v1/ref/subway/lines/:lineKey/stations", () => {
	test("returns the down stations of each branch", async () => {
		const res = await get("/lines/line2/stations");
		expect(res.status).toBe(200);
		expect(res.headers.get("etag")).toBe(`"subway-${trackBatchId}"`);
		const body = (await res.json()) as {
			batchId: number;
			branches: {
				branchKey: string;
				stations: { name: string; stop: string }[];
			}[];
		};
		expect(body.batchId).toBe(trackBatchId);
		expect(body.branches.map((branch) => branch.branchKey)).toEqual([
			"main",
			"sinjeong",
		]);
		expect(body.branches[0]?.stations[0]).toEqual({
			name: "순환6",
			stop: "seoul-subway:20006",
		});
		expect(body.branches[0]?.stations).toHaveLength(6);
		expect(body.branches[1]?.stations.map((s) => s.name)).toEqual([
			"지선3",
			"지선2",
			"지선1",
			"순환2",
		]);
	});

	test("answers 304 when the ETag matches", async () => {
		const res = await get("/lines/line7/stations", {
			"If-None-Match": `"subway-${trackBatchId}"`,
		});
		expect(res.status).toBe(304);
	});

	test("answers 404 for an unknown line", async () => {
		const res = await get("/lines/line99/stations");
		expect(res.status).toBe(404);
	});

	test("answers 503 when no track batch exists", async () => {
		const res = await emptyApp.request(
			`${API}/v1/ref/subway/lines/line2/stations`
		);
		expect(res.status).toBe(503);
	});
});

describe("GET /v1/ref/subway/direction", () => {
	const direction = (line: string, from: string, to: string) =>
		get(`/direction?line=${line}&from=${from}&to=${to}`);

	test("matches directionBetween on a straight line", async () => {
		const up = await direction("line7", "7001", "7003");
		expect(up.status).toBe(200);
		expect(await up.json()).toEqual({ direction: "up", stops: 2 });
		const down = await direction("line7", "7004", "7001");
		expect(await down.json()).toEqual({ direction: "down", stops: 3 });
	});

	test("takes the short way over a loop seam", async () => {
		const res = await direction("line2", "20006", "20001");
		expect(await res.json()).toEqual({ direction: "up", stops: 1 });
	});

	test("answers within a branch", async () => {
		const res = await direction("line2", "20002", "21002");
		expect(await res.json()).toEqual({ direction: "up", stops: 2 });
	});

	test("answers 404 not-direct across main and branch", async () => {
		const res = await direction("line2", "20003", "21003");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not-direct" });
	});

	test("answers 400 for the same station", async () => {
		const res = await direction("line7", "7002", "7002");
		expect(res.status).toBe(400);
	});

	test("answers 400 when a station is missing", async () => {
		const res = await get("/direction?line=line7&from=7001");
		expect(res.status).toBe(400);
	});

	test("answers 404 for an unknown line", async () => {
		const res = await direction("line99", "7001", "7002");
		expect(res.status).toBe(404);
	});

	test("accepts the prefixed ids the other endpoints return", async () => {
		const res = await direction(
			"seoul-subway:line7",
			"seoul-subway:7001",
			"seoul-subway:7002"
		);
		expect(await res.json()).toEqual({ direction: "up", stops: 1 });
	});
});

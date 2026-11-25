import { busRoute, referenceBatch } from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { beforeAll, describe, expect, it } from "bun:test";
import { readBusSchedules } from "./cf-ports";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

const route = (
	routeId: string,
	schedule: {
		firstBusMinute?: number | null;
		headwayMin?: number | null;
		lastBusMinute?: number | null;
	}
) => ({
	qualityFlags: [],
	region: "seoul" as const,
	routeId,
	routeName: routeId,
	routeType: "3",
	shortName: routeId,
	...schedule,
});

beforeAll(async () => {
	db = await createTestDb();
	const [old, current] = await db
		.insert(referenceBatch)
		.values([
			{ isCurrent: false, kind: "bus_route", sourceManifest: {} },
			{ isCurrent: true, kind: "bus_route", sourceManifest: {} },
		])
		.returning({ id: referenceBatch.id });
	if (!(old && current)) {
		throw new Error("seed batches missing");
	}
	await db.insert(busRoute).values([
		{
			...route("100100118", {
				firstBusMinute: 200,
				headwayMin: 20,
				lastBusMinute: 1300,
			}),
			batchId: old.id,
		},
		{ ...route("999000001", { headwayMin: 9 }), batchId: old.id },
		{
			...route("100100118", {
				firstBusMinute: 270,
				headwayMin: 13,
				lastBusMinute: 1370,
			}),
			batchId: current.id,
		},
		{
			...route("100100290", {
				firstBusMinute: 240,
				headwayMin: 8,
				lastBusMinute: 60,
			}),
			batchId: current.id,
		},
		{ ...route("100100001", { headwayMin: null }), batchId: current.id },
		{ ...route("100100002", { headwayMin: 0 }), batchId: current.id },
		// 서울 6411과 노선 ID가 같은 GBIS 노선. 출처로 구분한다.
		{
			...route("100100290", { headwayMin: 15 }),
			areaName: "고양",
			batchId: current.id,
			region: "gyeonggi" as const,
			source: "gbis" as const,
		},
		{
			...route("ICB165000012", { headwayMin: 25 }),
			areaName: "인천",
			batchId: current.id,
			region: "incheon" as const,
			source: "tago" as const,
			sourceCity: "23",
		},
	]);
});

describe("readBusSchedules", () => {
	it("reads headway and first/last bus from the current batch", async () => {
		expect(
			await readBusSchedules(db, [
				"seoul-bus:100100118",
				"seoul-bus:100100290",
				"seoul-bus:123456789",
			])
		).toEqual({
			"seoul-bus:100100118": {
				firstBusMinute: 270,
				headwayMin: 13,
				lastBusMinute: 1370,
			},
			"seoul-bus:100100290": {
				firstBusMinute: 240,
				headwayMin: 8,
				lastBusMinute: 60,
			},
		});
	});

	it("reads each source's row by (source, route id) and keys it by the full line ref", async () => {
		expect(
			await readBusSchedules(db, [
				"gbis:100100290",
				"tago:ICB165000012",
				"gbis:ICB165000012",
			])
		).toEqual({
			"gbis:100100290": {
				firstBusMinute: null,
				headwayMin: 15,
				lastBusMinute: null,
			},
			"tago:ICB165000012": {
				firstBusMinute: null,
				headwayMin: 25,
				lastBusMinute: null,
			},
		});
	});

	it("leaves out routes only in an old batch and routes without a headway", async () => {
		expect(
			await readBusSchedules(db, [
				"seoul-bus:999000001",
				"seoul-bus:100100001",
				"seoul-bus:100100002",
			])
		).toEqual({});
	});

	it("does not query for an empty list", async () => {
		expect(await readBusSchedules(db, [])).toEqual({});
	});
});

import {
	referenceBatch,
	stationCrosswalk,
	timetableStopTime,
	timetableTrip,
	trackStation,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
	TIMETABLE_LOGIC_VERSION,
	timetableManifest,
} from "../jobs/build-timetable";
import type { Trip } from "../timetable/model";
import {
	isCurrentManifest,
	loadCrosswalk,
	loadCurrentCrosswalk,
	loadCurrentTrips,
	loadTimetable,
	loadTracks,
} from "./load";

const row = {
	bldnId: "0150",
	coordSource: "station-master",
	lat: 37.556,
	lineKey: "line1",
	lng: 126.972,
	matchMethod: "auto-same-line",
	nameAliases: ["서울역"],
	nameCanonical: "서울",
	qualityFlags: [],
	statnId: "1001000133",
	subwayId: "1001",
} as const;

describe("loadCrosswalk", () => {
	it("creates a current batch and demotes the previous one", async () => {
		const db = await createTestDb();
		const a = await loadCrosswalk(db, [row], {
			xlsx: { fileName: "s57.xlsx", sha256: "a" },
		});
		const b = await loadCrosswalk(db, [row], {
			xlsx: { fileName: "s58.xlsx", sha256: "b" },
		});
		const batches = await db.select().from(referenceBatch);
		expect(batches.find((x) => x.id === a.batchId)?.isCurrent).toBe(false);
		expect(batches.find((x) => x.id === b.batchId)?.isCurrent).toBe(true);
		const rows = await db
			.select()
			.from(stationCrosswalk)
			.where(eq(stationCrosswalk.batchId, b.batchId));
		expect(rows.length).toBe(1);
	});
});

describe("loadCrosswalk rollback", () => {
	it("leaves no batch behind when a row insert fails", async () => {
		const db = await createTestDb();
		await expect(
			loadCrosswalk(db, [row, row], {
				xlsx: { fileName: "s57.xlsx", sha256: "a" },
			})
		).rejects.toThrow();
		expect(await db.select().from(referenceBatch)).toEqual([]);
	});
});

describe("loadTracks", () => {
	it("inserts shapes with their stations", async () => {
		const db = await createTestDb();
		const r = await loadTracks(
			db,
			[
				{
					attribution: "© OpenStreetMap contributors (ODbL)",
					branchKey: "main",
					coords: [
						[127, 37.5],
						[127.01, 37.5],
					],
					direction: "up",
					lengthM: 884,
					lineKey: "line2",
					osmRelationId: 1,
					stations: [
						{
							anchor: "osm-stop-projected",
							distanceM: 0,
							offsetM: 3,
							seq: 0,
							statnId: "1002000211",
						},
					],
				},
			],
			{}
		);
		expect(r.batchId).toBeGreaterThan(0);
		const stations = await db.select().from(trackStation);
		expect(stations.map((s) => [s.statnId, s.anchor])).toEqual([
			["1002000211", "osm-stop-projected"],
		]);
	});
});

describe("isCurrentManifest", () => {
	it("is true only for the manifest of the current batch of that kind", async () => {
		const db = await createTestDb();
		const manifest = {
			stationMaster: { fileName: "station-master.json", sha256: "m" },
			xlsx: { fileName: "s57.xlsx", sha256: "a" },
		};
		expect(await isCurrentManifest(db, "station_crosswalk", manifest)).toBe(
			false
		);
		await loadCrosswalk(db, [row], manifest);
		const reordered = Object.fromEntries(Object.entries(manifest).reverse());
		expect(await isCurrentManifest(db, "station_crosswalk", reordered)).toBe(
			true
		);
		expect(
			await isCurrentManifest(db, "station_crosswalk", {
				...manifest,
				xlsx: { fileName: "s58.xlsx", sha256: "b" },
			})
		).toBe(false);
		expect(await isCurrentManifest(db, "track", manifest)).toBe(false);
	});
});

describe("loadCurrentCrosswalk", () => {
	it("returns the rows of the current batch only", async () => {
		const db = await createTestDb();
		expect(await loadCurrentCrosswalk(db)).toEqual([]);
		await loadCrosswalk(db, [{ ...row, nameCanonical: "옛서울" }], {
			xlsx: { fileName: "s57.xlsx", sha256: "a" },
		});
		await loadCrosswalk(db, [{ ...row, frCode: "133", stationCd: "0150" }], {
			xlsx: { fileName: "s58.xlsx", sha256: "b" },
		});
		expect(await loadCurrentCrosswalk(db)).toEqual([
			{
				...row,
				frCode: "133",
				nameAliases: ["서울역"],
				qualityFlags: [],
				stationCd: "0150",
			},
		]);
	});
});

function tripOf(
	lineKey: Trip["lineKey"],
	trainNo: string,
	statnIds: string[]
): Trip {
	return {
		destinationStatnId: statnIds.at(-1),
		direction: "up",
		express: "local",
		lineKey,
		originStatnId: statnIds[0],
		qualityFlags: [],
		serviceDay: "weekday",
		serviceDaySource: "source",
		source: "seoul-metro-csv",
		sourceVersion: "2026-09-14",
		stops: statnIds.map((statnId, index) => ({
			arriveSec: index === 0 ? null : 18_000 + index * 120,
			departSec: 18_030 + index * 120,
			qualityFlags: [],
			seq: index + 1,
			statnId,
		})),
		trainNo,
	};
}

describe("loadTimetable", () => {
	it("loads trips with their stop times and reads back one line", async () => {
		const db = await createTestDb();
		const trips = [
			tripOf("line2", "2017", ["1002000211", "1002000210", "1002000209"]),
			tripOf("line2", "2019", ["1002000211", "1002000210"]),
			tripOf("line1", "K802", ["1001000150", "1001000151"]),
		];
		const { batchId } = await loadTimetable(db, trips, {});
		expect(batchId).toBeGreaterThan(0);
		const line2 = await loadCurrentTrips(db, "line2");
		expect(line2.length).toBe(2);
		expect(line2.map((t) => t.trainNo)).toEqual(["2017", "2019"]);
		const [first] = line2;
		expect(first?.id).toBeGreaterThan(0);
		const { id: _id, ...withoutId } = first ?? { id: 0 };
		expect(withoutId).toEqual(trips[0] as Trip);
		expect((await loadCurrentTrips(db)).length).toBe(3);
		expect((await db.select().from(timetableStopTime)).length).toBe(7);
	});
	it("reads only the current batch after a reload", async () => {
		const db = await createTestDb();
		const a = await loadTimetable(db, [tripOf("line2", "2017", ["A1", "A2"])], {
			csv: { fileName: "a.csv", sha256: "a" },
		});
		const b = await loadTimetable(
			db,
			[
				tripOf("line2", "2017", ["A1", "A2"]),
				tripOf("line2", "2021", ["A1", "A2"]),
			],
			{ csv: { fileName: "b.csv", sha256: "b" } }
		);
		const batches = await db.select().from(referenceBatch);
		expect(batches.find((x) => x.id === a.batchId)?.isCurrent).toBe(false);
		expect(batches.find((x) => x.id === b.batchId)?.kind).toBe("timetable");
		expect(batches.find((x) => x.id === b.batchId)?.isCurrent).toBe(true);
		expect((await loadCurrentTrips(db, "line2")).length).toBe(2);
		expect((await db.select().from(timetableTrip)).length).toBe(3);
	});
	it("inserts more trips and stop times than one chunk holds", async () => {
		const db = await createTestDb();
		const stations = Array.from(
			{ length: 5 },
			(_, i) => `10020002${String(i).padStart(2, "0")}`
		);
		const trips = Array.from({ length: 600 }, (_, i) =>
			tripOf("line2", `T${i}`, stations)
		);
		await loadTimetable(db, trips, {});
		const loaded = await loadCurrentTrips(db, "line2");
		expect(loaded.length).toBe(600);
		expect(loaded.every((t) => t.stops.length === 5)).toBe(true);
		expect(loaded.find((t) => t.trainNo === "T599")?.stops[4]?.seq).toBe(5);
	});
	it("leaves no batch behind when a trip insert fails", async () => {
		const db = await createTestDb();
		const trip = tripOf("line2", "2017", ["A1", "A2"]);
		await expect(loadTimetable(db, [trip, trip], {})).rejects.toThrow();
		expect(await db.select().from(referenceBatch)).toEqual([]);
	});
});

describe("timetableManifest", () => {
	const sources = {
		seoulMetroCsv: { fileName: "timetable.csv", sha256: "abc" },
	};
	it("reloads when only the timetable version differs", async () => {
		const db = await createTestDb();
		await loadTimetable(
			db,
			[],
			timetableManifest(sources, TIMETABLE_LOGIC_VERSION - 1)
		);
		expect(
			await isCurrentManifest(db, "timetable", timetableManifest(sources))
		).toBe(false);
	});
	it("skips when the version and sources are the same", async () => {
		const db = await createTestDb();
		await loadTimetable(db, [], timetableManifest(sources));
		expect(
			await isCurrentManifest(db, "timetable", timetableManifest(sources))
		).toBe(true);
		expect(timetableManifest(sources).timetableVersion).toEqual({
			fileName: "timetable logic",
			sha256: `v${TIMETABLE_LOGIC_VERSION}`,
		});
	});
});

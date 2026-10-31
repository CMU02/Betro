import {
	referenceBatch,
	stationCrosswalk,
	trackStation,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
	isCurrentManifest,
	loadCrosswalk,
	loadCurrentCrosswalk,
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

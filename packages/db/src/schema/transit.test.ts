import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-db";
import {
	referenceBatch,
	stationCrosswalk,
	trackShape,
	trackStation,
} from "./transit";

describe("transit schema", () => {
	it("round-trips a batch with crosswalk, shape, and station rows", async () => {
		const db = await createTestDb();
		const [batch] = await db
			.insert(referenceBatch)
			.values({
				kind: "track",
				sourceManifest: { osm: { fileName: "osm.json", sha256: "ab" } },
			})
			.returning();
		if (!batch) {
			throw new Error("no batch");
		}
		await db.insert(stationCrosswalk).values({
			batchId: batch.id,
			coordSource: "station-master",
			lat: 37.5445,
			lineKey: "line2",
			lng: 127.0559,
			matchMethod: "auto-same-line",
			nameAliases: ["성수"],
			nameCanonical: "성수",
			qualityFlags: [],
			statnId: "1002000211",
			subwayId: "1002",
		});
		const [shape] = await db
			.insert(trackShape)
			.values({
				attribution: "© OpenStreetMap contributors (ODbL)",
				batchId: batch.id,
				branchKey: "main",
				coords: [
					[127.0, 37.5],
					[127.01, 37.5],
				],
				direction: "up",
				lengthM: 884,
				lineKey: "line2",
				osmRelationId: 1,
			})
			.returning();
		if (!shape) {
			throw new Error("no shape");
		}
		await db.insert(trackStation).values({
			distanceM: 0,
			offsetM: 12.3,
			seq: 0,
			statnId: "1002000211",
			trackShapeId: shape.id,
		});
		const found = await db
			.select()
			.from(trackStation)
			.where(eq(trackStation.trackShapeId, shape.id));
		expect(found.length).toBe(1);
		expect(found[0]?.statnId).toBe("1002000211");
		const shapes = await db.select().from(trackShape);
		expect(shapes[0]?.coords).toEqual([
			[127.0, 37.5],
			[127.01, 37.5],
		]);
	});
	it("rejects duplicate statn_id within one batch", async () => {
		const db = await createTestDb();
		const [batch] = await db
			.insert(referenceBatch)
			.values({ kind: "station_crosswalk", sourceManifest: {} })
			.returning();
		if (!batch) {
			throw new Error("no batch");
		}
		const row: typeof stationCrosswalk.$inferInsert = {
			batchId: batch.id,
			coordSource: "station-master",
			lat: 37.55,
			lineKey: "line1",
			lng: 126.97,
			matchMethod: "auto-same-line",
			nameAliases: [],
			nameCanonical: "서울",
			qualityFlags: [],
			statnId: "1001000133",
			subwayId: "1001",
		};
		await db.insert(stationCrosswalk).values(row);
		await expect(
			(async () => await db.insert(stationCrosswalk).values(row))()
		).rejects.toThrow();
	});
});

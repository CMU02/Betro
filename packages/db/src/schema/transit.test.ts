import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../test-db";
import { referenceBatch, stationCrosswalk, trackShape, trackStation } from "./transit";

describe("transit schema", () => {
  it("round-trips a batch with crosswalk, shape, and station rows", async () => {
    const db = await createTestDb();
    const [batch] = await db.insert(referenceBatch).values({ kind: "track", sourceManifest: { osm: { fileName: "osm.json", sha256: "ab" } } }).returning();
    if (!batch) throw new Error("no batch");
    await db.insert(stationCrosswalk).values({ batchId: batch.id, statnId: "1002000211", subwayId: "1002", lineKey: "line2", nameCanonical: "성수", nameAliases: ["성수"], lat: 37.5445, lng: 127.0559, coordSource: "station-master", matchMethod: "auto-same-line", qualityFlags: [] });
    const [shape] = await db.insert(trackShape).values({ batchId: batch.id, lineKey: "line2", branchKey: "main", direction: "up", osmRelationId: 1, coords: [[127.0, 37.5], [127.01, 37.5]], lengthM: 884, attribution: "© OpenStreetMap contributors (ODbL)" }).returning();
    if (!shape) throw new Error("no shape");
    await db.insert(trackStation).values({ trackShapeId: shape.id, statnId: "1002000211", seq: 0, distanceM: 0, offsetM: 12.3 });
    const found = await db.select().from(trackStation).where(eq(trackStation.trackShapeId, shape.id));
    expect(found.length).toBe(1);
    expect(found[0]?.statnId).toBe("1002000211");
    const shapes = await db.select().from(trackShape);
    expect(shapes[0]?.coords).toEqual([[127.0, 37.5], [127.01, 37.5]]);
  });
  it("rejects duplicate statn_id within one batch", async () => {
    const db = await createTestDb();
    const [batch] = await db.insert(referenceBatch).values({ kind: "station_crosswalk", sourceManifest: {} }).returning();
    if (!batch) throw new Error("no batch");
    const row = { batchId: batch.id, statnId: "1001000133", subwayId: "1001", lineKey: "line1", nameCanonical: "서울", nameAliases: [], lat: 37.55, lng: 126.97, coordSource: "station-master", matchMethod: "auto-same-line", qualityFlags: [] } as const;
    await db.insert(stationCrosswalk).values(row);
    await expect((async () => await db.insert(stationCrosswalk).values(row))()).rejects.toThrow();
  });
});

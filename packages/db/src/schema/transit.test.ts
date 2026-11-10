import { describe, expect, it } from "bun:test";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb } from "../index";
import { createTestDb } from "../test-db";
import {
	busRoute,
	busRouteSegment,
	busRouteShape,
	busRouteStop,
	referenceBatch,
	stationCrosswalk,
	timetableStopTime,
	timetableTrip,
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
			anchor: "osm-stop",
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
		expect(found[0]?.anchor).toBe("osm-stop");
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

	it("timetable trip and stop time round-trip", async () => {
		const db = await createTestDb();
		const [batch] = await db
			.insert(referenceBatch)
			.values({ kind: "timetable", sourceManifest: {} })
			.returning();
		if (!batch) {
			throw new Error("no batch");
		}
		const [trip] = await db
			.insert(timetableTrip)
			.values({
				batchId: batch.id,
				direction: "up",
				express: "local",
				lineKey: "line2",
				qualityFlags: [],
				serviceDay: "weekday",
				serviceDaySource: "source",
				source: "seoul-metro-csv",
				sourceVersion: "2026-09-14",
				trainNo: "2001",
			})
			.returning();
		if (!trip) {
			throw new Error("no trip");
		}
		await db.insert(timetableStopTime).values([
			{
				arriveSec: null,
				departSec: 18_000,
				qualityFlags: [],
				seq: 0,
				statnId: "1002000201",
				tripId: trip.id,
			},
			{
				arriveSec: 18_120,
				departSec: 18_150,
				qualityFlags: [],
				seq: 1,
				statnId: "1002000202",
				tripId: trip.id,
			},
		]);
		const rows = await db
			.select()
			.from(timetableStopTime)
			.orderBy(timetableStopTime.seq);
		expect(rows.map((r) => r.departSec)).toEqual([18_000, 18_150]);
	});

	it("rejects a duplicate trip key in one batch", async () => {
		const db = await createTestDb();
		const [batch] = await db
			.insert(referenceBatch)
			.values({ kind: "timetable", sourceManifest: {} })
			.returning();
		if (!batch) {
			throw new Error("no batch");
		}
		const row: typeof timetableTrip.$inferInsert = {
			batchId: batch.id,
			direction: "down",
			express: "local",
			lineKey: "line2",
			qualityFlags: [],
			serviceDay: "weekday",
			serviceDaySource: "source",
			source: "seoul-metro-csv",
			sourceVersion: "2026-09-14",
			trainNo: "2001",
		};
		await db.insert(timetableTrip).values(row);
		await expect(
			(async () => await db.insert(timetableTrip).values(row))()
		).rejects.toThrow();
	});

	it("bus route rows round-trip and cascade", async () => {
		const db = await createTestDb();
		const [batch] = await db
			.insert(referenceBatch)
			.values({ kind: "bus_route", sourceManifest: {} })
			.returning();
		if (!batch) {
			throw new Error("no batch");
		}
		const [route] = await db
			.insert(busRoute)
			.values({
				batchId: batch.id,
				qualityFlags: ["warn"],
				region: "gyeonggi",
				routeId: "234001243",
				routeName: "M5107광주",
				routeType: "8",
				shortName: "M5107",
			})
			.returning();
		if (!route) {
			throw new Error("no route");
		}
		await db.insert(busRouteShape).values({
			attribution: "서울특별시 버스노선정보(공공데이터포털)",
			busRouteId: route.id,
			coords: [
				[127.0, 37.5],
				[127.01, 37.5],
			],
			lengthM: 884,
		});
		const stop: typeof busRouteStop.$inferInsert = {
			apiSectDistM: 0,
			arsId: "15227",
			busRouteId: route.id,
			directionName: "선릉역",
			distanceM: 0,
			lat: 37.5,
			lng: 127.0,
			name: "정류소",
			offsetM: 3.2,
			qualityFlags: [],
			seq: 1,
			stationId: "114000124",
		};
		await db.insert(busRouteStop).values([stop, { ...stop, seq: 2 }]);
		await db.insert(busRouteSegment).values({
			apiSectDistM: 880,
			busRouteId: route.id,
			endM: 884,
			fromSeq: 1,
			qualityFlags: ["a"],
			startM: 0,
			toSeq: 2,
		});

		const [shape] = await db.select().from(busRouteShape);
		expect(shape?.coords).toEqual([
			[127.0, 37.5],
			[127.01, 37.5],
		]);
		const [segment] = await db.select().from(busRouteSegment);
		expect(segment?.qualityFlags).toEqual(["a"]);
		const [storedRoute] = await db.select().from(busRoute);
		expect(storedRoute?.qualityFlags).toEqual(["warn"]);

		await expect(
			(async () => await db.insert(busRouteStop).values(stop))()
		).rejects.toThrow();

		await db.delete(referenceBatch).where(eq(referenceBatch.id, batch.id));
		expect((await db.select().from(busRoute)).length).toBe(0);
		expect((await db.select().from(busRouteShape)).length).toBe(0);
		expect((await db.select().from(busRouteStop)).length).toBe(0);
		expect((await db.select().from(busRouteSegment)).length).toBe(0);
	});
});

describe("bus_route region migration", () => {
	const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));
	const REGION_MIGRATION = "20261110062424_bus_route_region";

	it("fills short_name from route_name and region with seoul for existing rows", async () => {
		const before = await mkdtemp(join(tmpdir(), "betro-migrations-"));
		try {
			const folders = (await readdir(MIGRATIONS, { withFileTypes: true }))
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.filter((name) => name < REGION_MIGRATION);
			await Promise.all(
				folders.map((name) =>
					cp(join(MIGRATIONS, name), join(before, name), { recursive: true })
				)
			);
			const db = createDb({ DATABASE_URL: ":memory:" });
			await migrate(db, { migrationsFolder: before });
			await db.$client.execute(
				"INSERT INTO reference_batch (id, kind, source_manifest) VALUES (1, 'bus_route', '{}')"
			);
			await db.$client.execute(
				"INSERT INTO bus_route (batch_id, quality_flags, route_id, route_name, route_type) VALUES (1, '[]', '100100290', '6411', '3')"
			);
			await migrate(db, { migrationsFolder: MIGRATIONS });
			const [row] = await db.select().from(busRoute);
			expect(row?.shortName).toBe("6411");
			expect(row?.region).toBe("seoul");
		} finally {
			await rm(before, { force: true, recursive: true });
		}
	});
});

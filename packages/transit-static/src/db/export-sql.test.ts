import type { LibsqlDatabase } from "@Betro/db";
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
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { describe, expect, it } from "bun:test";
import {
	currentFlipSql,
	D1_MAX_STATEMENT_BYTES,
	D1_PUBLISH_KINDS,
	exportBatchSql,
	sqlLiteral,
} from "./export-sql";

const ALL_TABLES = [
	"reference_batch",
	"station_crosswalk",
	"track_shape",
	"track_station",
	"timetable_trip",
	"timetable_stop_time",
	"bus_route",
	"bus_route_shape",
	"bus_route_stop",
	"bus_route_segment",
] as const;

const INSERT_TABLE_PATTERN = /^INSERT INTO "([a-z_]+)"/;

/** 각 행을 SQLite quote()로 읽어 정수·실수·문자열·NULL 구분까지 비교한다. */
async function dumpTable(db: LibsqlDatabase, table: string): Promise<string[]> {
	const info = await db.$client.execute(`PRAGMA table_info("${table}")`);
	const columns = info.rows.map((row) => String(row.name));
	const result = await db.$client.execute(
		`SELECT ${columns.map((c) => `quote("${c}")`).join(" || '|' || ")} AS line FROM "${table}" ORDER BY "id"`
	);
	return result.rows.map((row) => String(row.line));
}

async function executeAll(
	db: LibsqlDatabase,
	statements: readonly string[]
): Promise<void> {
	await db.$client.execute("PRAGMA foreign_keys = ON");
	await db.$client.executeMultiple(statements.join("\n"));
}

/** 대응표 2행, 선로 1모양 2역, trip 1개 정차 2개, 버스 노선 1개 정류소 2개 구간 1개. */
async function seedSmallBatches(db: LibsqlDatabase): Promise<number[]> {
	const [crosswalk, track, timetable, bus] = await db
		.insert(referenceBatch)
		.values([
			{
				isCurrent: true,
				kind: "station_crosswalk",
				sourceManifest: {
					xlsx: { fileName: "역 's57'.xlsx", sha256: "a1" },
				},
			},
			{
				isCurrent: true,
				kind: "track",
				sourceManifest: { osm: { fileName: "osm.json", sha256: "b2" } },
			},
			{
				isCurrent: true,
				kind: "timetable",
				sourceManifest: { csv: { fileName: "tt.csv", sha256: "c3" } },
			},
			{
				isCurrent: false,
				kind: "bus_route",
				sourceManifest: { bus: { fileName: "bus.json", sha256: "d4" } },
			},
		])
		.returning({ id: referenceBatch.id });
	if (!(crosswalk && track && timetable && bus)) {
		throw new Error("seed batches missing");
	}
	await db.insert(stationCrosswalk).values([
		{
			batchId: crosswalk.id,
			bldnId: "0150",
			coordSource: "station-master",
			frCode: null,
			lat: 37.556_123_456_789,
			lineKey: "line1",
			lng: 126.972,
			matchMethod: "auto-same-line",
			nameAliases: ["서울역", "Seoul 'Station'"],
			nameCanonical: "서울",
			qualityFlags: [],
			stationCd: null,
			statnId: "1001000133",
			subwayId: "1001",
		},
		{
			batchId: crosswalk.id,
			bldnId: null,
			coordSource: "osm",
			frCode: "K'01",
			lat: 37,
			lineKey: "line2",
			lng: 127,
			matchMethod: "manual-alias",
			nameAliases: [],
			nameCanonical: "어린이대공원(세종대)'역",
			qualityFlags: ["coord-fallback", 'quote"inside'],
			stationCd: "0212",
			statnId: "1002000212",
			subwayId: "1002",
		},
	]);
	const [shape] = await db
		.insert(trackShape)
		.values({
			attribution: "© OpenStreetMap contributors (ODbL)",
			batchId: track.id,
			branchKey: "main",
			coords: [
				[127, 37.5],
				[127.012_345_678_9, 37.500_000_1],
			],
			direction: "up",
			lengthM: 884.25,
			lineKey: "line2",
			osmRelationId: 9_876_543_210,
		})
		.returning({ id: trackShape.id });
	if (!shape) {
		throw new Error("seed shape missing");
	}
	await db.insert(trackStation).values([
		{
			anchor: "osm-stop",
			distanceM: 0,
			offsetM: 0,
			osmStopNodeId: 12_345_678_901,
			seq: 0,
			statnId: "1002000211",
			trackShapeId: shape.id,
		},
		{
			anchor: "station-master",
			distanceM: 884.25,
			offsetM: -3.5,
			osmStopNodeId: null,
			seq: 1,
			statnId: "1002000212",
			trackShapeId: shape.id,
		},
	]);
	const [trip] = await db
		.insert(timetableTrip)
		.values({
			batchId: timetable.id,
			destinationStatnId: null,
			direction: "down",
			express: "local",
			lineKey: "line2",
			originStatnId: "1002000211",
			qualityFlags: [],
			serviceDay: "weekday",
			serviceDaySource: "source",
			source: "seoul-metro-csv",
			sourceVersion: "2026-10-31",
			trainNo: "2001",
		})
		.returning({ id: timetableTrip.id });
	if (!trip) {
		throw new Error("seed trip missing");
	}
	await db.insert(timetableStopTime).values([
		{
			arriveSec: null,
			departSec: 18_000,
			qualityFlags: [],
			seq: 0,
			statnId: "1002000211",
			tripId: trip.id,
		},
		{
			arriveSec: 90_000,
			departSec: null,
			qualityFlags: ["after-midnight"],
			seq: 1,
			statnId: "1002000212",
			tripId: trip.id,
		},
	]);
	const [route] = await db
		.insert(busRoute)
		.values({
			batchId: bus.id,
			qualityFlags: [],
			region: "seoul",
			routeId: "100100290",
			routeName: "6411",
			routeType: "3",
			shortName: "6411",
		})
		.returning({ id: busRoute.id });
	if (!route) {
		throw new Error("seed route missing");
	}
	await db.insert(busRouteShape).values({
		attribution: "서울특별시 'TOPIS'",
		busRouteId: route.id,
		coords: [
			[126.9, 37.4],
			[126.91, 37.41],
		],
		lengthM: 1500.5,
	});
	await db.insert(busRouteStop).values([
		{
			apiSectDistM: 0,
			arsId: "22001",
			busRouteId: route.id,
			directionName: null,
			distanceM: 0,
			lat: 37.4,
			lng: 126.9,
			name: "구로 '차고지'",
			offsetM: 0,
			qualityFlags: [],
			seq: 1,
			stationId: "116000001",
		},
		{
			apiSectDistM: 1500,
			arsId: null,
			busRouteId: route.id,
			directionName: "개포동",
			distanceM: 1500.5,
			lat: 37.41,
			lng: 126.91,
			name: "다음 정류소",
			offsetM: 2.25,
			qualityFlags: ["far-from-shape"],
			seq: 2,
			stationId: "116000002",
		},
	]);
	await db.insert(busRouteSegment).values({
		apiSectDistM: 1500,
		busRouteId: route.id,
		endM: 1500.5,
		fromSeq: 1,
		qualityFlags: [],
		startM: 0,
		toSeq: 2,
	});
	return [crosswalk.id, track.id, timetable.id, bus.id];
}

describe("exportBatchSql", () => {
	it("export round-trips into an empty database", async () => {
		const source = await createTestDb();
		const batchIds = await seedSmallBatches(source);
		// 내보내지 않는 다른 배치는 따라가면 안 된다.
		const [other] = await source
			.insert(referenceBatch)
			.values({ kind: "station_crosswalk", sourceManifest: {} })
			.returning({ id: referenceBatch.id });
		if (!other) {
			throw new Error("other batch missing");
		}
		await source.insert(stationCrosswalk).values({
			batchId: other.id,
			coordSource: "osm",
			lat: 1,
			lineKey: "line1",
			lng: 2,
			matchMethod: "auto-shared",
			nameAliases: [],
			nameCanonical: "다른 배치",
			qualityFlags: [],
			statnId: "1001000133",
			subwayId: "1001",
		});

		const statements = await exportBatchSql(source, batchIds);
		// bus_route INSERT에 지역을 뗀 이름과 지역 열이 있다.
		const busInsert = statements.find((sql) =>
			sql.startsWith('INSERT INTO "bus_route" (')
		);
		expect(busInsert).toContain('"short_name"');
		expect(busInsert).toContain('"region"');
		expect(busInsert).toContain("'seoul','100100290','6411','3','6411'");
		const target = await createTestDb();
		await executeAll(target, statements);

		for (const table of ALL_TABLES) {
			// biome-ignore lint/performance/noAwaitInLoops: tables are compared one by one
			const expected = await dumpTable(source, table);
			const actual = await dumpTable(target, table);
			if (table === "reference_batch" || table === "station_crosswalk") {
				expect(actual).toEqual(expected.slice(0, -1));
			} else {
				expect(actual).toEqual(expected);
			}
		}
		expect(await target.select().from(stationCrosswalk)).toEqual(
			(await source.select().from(stationCrosswalk)).slice(0, -1)
		);
		expect(await target.select().from(referenceBatch)).toEqual(
			(await source.select().from(referenceBatch)).slice(0, -1)
		);
	});

	it("puts parents before children", async () => {
		const source = await createTestDb();
		const batchIds = await seedSmallBatches(source);
		const statements = await exportBatchSql(source, batchIds);
		const order = statements.map(
			(statement) => INSERT_TABLE_PATTERN.exec(statement)?.[1]
		);
		expect(order).toEqual([...ALL_TABLES]);
	});

	it("splits statements under the byte limit", async () => {
		const source = await createTestDb();
		const [batch] = await source
			.insert(referenceBatch)
			.values({
				isCurrent: true,
				kind: "station_crosswalk",
				sourceManifest: {},
			})
			.returning({ id: referenceBatch.id });
		if (!batch) {
			throw new Error("batch missing");
		}
		const rowCount = 5000;
		const rows = Array.from({ length: rowCount }, (_, index) => ({
			batchId: batch.id,
			coordSource: "station-master",
			lat: 37 + index / 10_000,
			lineKey: "line2",
			lng: 127 + index / 10_000,
			matchMethod: "auto-same-line" as const,
			nameAliases: [`역 이름 ${index}`, `'따옴표' ${index}`],
			nameCanonical: `역 ${index}`,
			qualityFlags: ["a-long-quality-flag-to-make-rows-bigger"],
			statnId: `S${index}`,
			subwayId: "1002",
		}));
		for (let start = 0; start < rows.length; start += 500) {
			// biome-ignore lint/performance/noAwaitInLoops: seed chunks go in one by one
			await source
				.insert(stationCrosswalk)
				.values(rows.slice(start, start + 500));
		}

		const statements = await exportBatchSql(source, [batch.id]);
		const encoder = new TextEncoder();
		for (const statement of statements) {
			expect(encoder.encode(statement).length).toBeLessThanOrEqual(
				D1_MAX_STATEMENT_BYTES
			);
		}
		expect(statements.length).toBeGreaterThan(2);

		const target = await createTestDb();
		await executeAll(target, statements);
		const [counted] = (
			await target.$client.execute(
				'SELECT count(*) AS n FROM "station_crosswalk"'
			)
		).rows;
		expect(Number(counted?.n)).toBe(rowCount);
	});

	it("returns nothing for no batches", async () => {
		const source = await createTestDb();
		expect(await exportBatchSql(source, [])).toEqual([]);
	});
});

describe("sqlLiteral", () => {
	it("writes SQLite literals", () => {
		expect(sqlLiteral(null)).toBe("NULL");
		expect(sqlLiteral("it's")).toBe("'it''s'");
		expect(sqlLiteral(1.5)).toBe("1.5");
		expect(sqlLiteral(true)).toBe("1");
		expect(sqlLiteral(new Uint8Array([0, 255]))).toBe("X'00ff'");
		expect(() => sqlLiteral(Number.NaN)).toThrow();
	});
});

describe("currentFlipSql", () => {
	it("marks one current batch per kind", async () => {
		const statements = currentFlipSql({
			bus_route: 2,
			station_crosswalk: 8,
			timetable: 9,
			track: 5,
		});
		expect(statements).toEqual(
			D1_PUBLISH_KINDS.map(
				(kind) =>
					`UPDATE "reference_batch" SET "is_current" = ("id" = ${
						{ bus_route: 2, station_crosswalk: 8, timetable: 9, track: 5 }[kind]
					}) WHERE "kind" = '${kind}';`
			)
		);

		const db = await createTestDb();
		await db.insert(referenceBatch).values([
			{ id: 1, isCurrent: true, kind: "bus_route", sourceManifest: {} },
			{ id: 2, kind: "bus_route", sourceManifest: {} },
			{ id: 5, kind: "track", sourceManifest: {} },
			{ id: 8, kind: "station_crosswalk", sourceManifest: {} },
			{ id: 9, kind: "timetable", sourceManifest: {} },
		]);
		await executeAll(db, statements);
		const rows = await db
			.select({ id: referenceBatch.id, isCurrent: referenceBatch.isCurrent })
			.from(referenceBatch);
		expect(rows.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([
			2, 5, 8, 9,
		]);
	});
});

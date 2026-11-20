import type { LibsqlDatabase } from "@Betro/db";
import {
	type BusRegion,
	type BusSource,
	busRoute,
	busRouteShape,
	referenceBatch,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { describe, expect, test } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { D1ReferenceSource } from "./cf-ports";

type SqlArg = string | number | null;

/** D1ReferenceSource가 쓰는 prepare → bind → all 만 libsql 위에 흉내 낸다. */
function d1Over(db: LibsqlDatabase): D1Database {
	const statement = (sql: string, args: SqlArg[] = []) => ({
		all: async () => {
			const result = await db.$client.execute({ args, sql });
			return {
				results: result.rows.map((row) =>
					Object.fromEntries(
						result.columns.map((column, index) => [column, row[index]])
					)
				),
			};
		},
		bind: (...next: SqlArg[]) => statement(sql, next),
	});
	return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

describe("D1ReferenceSource.currentBusRouteIds", () => {
	test("leaves Incheon and Gyeonggi routes out of map observation", async () => {
		const db = await createTestDb();
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
		const row = (
			batchId: number,
			routeId: string,
			routeType: string,
			region: BusRegion,
			origin: BusSource = "seoul"
		) => ({
			batchId,
			qualityFlags: [],
			region,
			routeId,
			routeName: routeId,
			routeType,
			shortName: routeId,
			source: origin,
		});
		await db
			.insert(busRoute)
			.values([
				row(current.id, "100100290", "4", "seoul"),
				row(current.id, "111900010", "2", "seoul"),
				row(current.id, "234001243", "8", "gyeonggi"),
				row(current.id, "165000215", "7", "incheon"),
				row(current.id, "224000011", "30", "gyeonggi", "gbis"),
				row(current.id, "ICB165000012", "13", "incheon", "tago"),
				row(old.id, "100100001", "4", "seoul"),
			]);

		const reference = new D1ReferenceSource(d1Over(db));
		expect(await reference.currentBusRouteIds()).toEqual([
			"100100290",
			"111900010",
		]);
	});
});

describe("D1ReferenceSource.loadBus", () => {
	test("looks routes up among Seoul rows only, even when a GBIS id collides", async () => {
		const db = await createTestDb();
		const [current] = await db
			.insert(referenceBatch)
			.values({ isCurrent: true, kind: "bus_route", sourceManifest: {} })
			.returning({ id: referenceBatch.id });
		if (!current) {
			throw new Error("seed batch missing");
		}
		const row = (origin: BusSource, region: BusRegion) => ({
			batchId: current.id,
			qualityFlags: [],
			region,
			routeId: "100100001",
			routeName: "100",
			routeType: "3",
			shortName: "100",
			source: origin,
		});
		const [seoul, gbis] = await db
			.insert(busRoute)
			.values([row("seoul", "seoul"), row("gbis", "gyeonggi")])
			.returning({ id: busRoute.id });
		if (!(seoul && gbis)) {
			throw new Error("seed route missing");
		}
		await db.insert(busRouteShape).values([
			{ attribution: "t", busRouteId: seoul.id, coords: [], lengthM: 111 },
			{ attribution: "t", busRouteId: gbis.id, coords: [], lengthM: 222 },
		]);

		const reference = new D1ReferenceSource(d1Over(db));
		const { routes } = await reference.loadBus(["100100001"], false);
		expect(routes.size).toBe(1);
		expect(routes.get("100100001")?.lengthM).toBe(111);
	});
});

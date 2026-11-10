import type { LibsqlDatabase } from "@Betro/db";
import {
	type BusRegion,
	busRoute,
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
			region: BusRegion
		) => ({
			batchId,
			qualityFlags: [],
			region,
			routeId,
			routeName: routeId,
			routeType,
			shortName: routeId,
		});
		await db
			.insert(busRoute)
			.values([
				row(current.id, "100100290", "4", "seoul"),
				row(current.id, "111900010", "2", "seoul"),
				row(current.id, "234001243", "8", "gyeonggi"),
				row(current.id, "165000215", "7", "incheon"),
				row(old.id, "100100001", "4", "seoul"),
			]);

		const source = new D1ReferenceSource(d1Over(db));
		expect(await source.currentBusRouteIds()).toEqual([
			"100100290",
			"111900010",
		]);
	});
});

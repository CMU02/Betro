import { createTestDb } from "@Betro/db/test-db";
import { beforeAll, describe, expect, test } from "bun:test";
import { findBusRouteStops, searchBusRoutes } from "./bus";
import {
	busLine,
	busStop,
	parseBusRef,
	subwayLine,
	subwayStation,
} from "./ids";
import {
	GBIS_COLLIDING_ROUTE_ID,
	GBIS_OTHER_ROUTE_ID,
	GBIS_ROUTE_ID,
	OLD_ONLY_ROUTE_ID,
	seedBusReference,
} from "./test-seed";

type Db = Awaited<ReturnType<typeof createTestDb>>;

let db: Db;
let currentBatchId: number;

beforeAll(async () => {
	db = await createTestDb();
	({ currentBatchId } = await seedBusReference(db));
});

describe("ids", () => {
	test("builds source-qualified refs", () => {
		expect(busLine("seoul", "100100290")).toBe("seoul-bus:100100290");
		expect(busStop("seoul", "111000001")).toBe("seoul-bus:111000001");
		expect(busLine("gbis", "224000011")).toBe("gbis:224000011");
		expect(busStop("tago", "ICB1")).toBe("tago:ICB1");
		expect(subwayLine("line2")).toBe("seoul-subway:line2");
		expect(subwayStation("1002000222")).toBe("seoul-subway:1002000222");
	});
});

describe("parseBusRef", () => {
	test("reads the source from the prefix and treats bare values as Seoul", () => {
		expect(parseBusRef("gbis:224000011")).toEqual({
			id: "224000011",
			source: "gbis",
		});
		expect(parseBusRef("tago:ICB165000012")).toEqual({
			id: "ICB165000012",
			source: "tago",
		});
		expect(parseBusRef("seoul-bus:100100001")).toEqual({
			id: "100100001",
			source: "seoul",
		});
		expect(parseBusRef("100100001")).toEqual({
			id: "100100001",
			source: "seoul",
		});
	});
});

describe("searchBusRoutes", () => {
	test("lists same-numbered GBIS village buses apart by area name", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "11" });
		expect(
			result?.routes.map(({ areaName, line }) => ({ areaName, line }))
		).toEqual([
			{ areaName: "성남", line: `gbis:${GBIS_ROUTE_ID}` },
			{ areaName: "수원", line: `gbis:${GBIS_OTHER_ROUTE_ID}` },
		]);
	});

	test("returns same-named routes of both regions, Seoul first", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "1000" });
		expect(result?.batchId).toBe(currentBatchId);
		expect(result?.routes.map((route) => route.region)).toEqual([
			"seoul",
			"gyeonggi",
		]);
		expect(result?.routes.map((route) => route.line)).toEqual([
			"seoul-bus:100100001",
			"seoul-bus:200000001",
		]);
	});

	test("puts the exact short name before names that merely contain it", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "100" });
		expect(result?.routes.map((route) => route.shortName)).toEqual([
			"100",
			"1000",
			"1000",
		]);
	});

	test("matches case-insensitively and strips the region from shortName", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "m5107" });
		expect(result?.routes).toEqual([
			{
				areaName: null,
				line: "seoul-bus:234001243",
				name: "M5107광주",
				region: "gyeonggi",
				routeType: "8",
				shortName: "M5107",
			},
		]);
	});

	test("finds village buses by a partial name", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "서초" });
		expect(result?.routes.map((route) => route.name)).toEqual(["서초03"]);
	});

	test("treats % and _ in the query as plain characters", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "%" });
		expect(result?.routes).toEqual([]);
	});

	test("does not return routes of an old batch", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "옛노선" });
		expect(result?.routes).toEqual([]);
	});

	test("honors the limit", async () => {
		const result = await searchBusRoutes(db, { limit: 1, q: "100" });
		expect(result?.routes).toHaveLength(1);
	});
});

describe("findBusRouteStops", () => {
	test("lists stops in seq order with source-qualified stop refs", async () => {
		const result = await findBusRouteStops(db, "100100001");
		expect(result?.batchId).toBe(currentBatchId);
		expect(result?.route?.line).toBe("seoul-bus:100100001");
		expect(result?.route?.shortName).toBe("1000");
		expect(result?.route?.stops).toEqual([
			{
				arsId: null,
				directionName: "종점행",
				name: "첫째",
				seq: 1,
				stop: "seoul-bus:S1",
			},
			{
				arsId: "01002",
				directionName: null,
				name: "둘째",
				seq: 2,
				stop: "seoul-bus:S2",
			},
			{
				arsId: "01003",
				directionName: null,
				name: "셋째",
				seq: 3,
				stop: "seoul-bus:S3",
			},
		]);
	});

	test("finds a GBIS route by its prefixed ref with prefixed stop refs", async () => {
		const result = await findBusRouteStops(db, `gbis:${GBIS_ROUTE_ID}`);
		expect(result?.route?.line).toBe(`gbis:${GBIS_ROUTE_ID}`);
		expect(result?.route?.areaName).toBe("성남");
		expect(result?.route?.stops.map((stop) => stop.stop)).toEqual([
			"gbis:S1",
			"gbis:G2",
		]);
	});

	test("keeps a Seoul route and a GBIS route with the same id apart", async () => {
		const seoul = await findBusRouteStops(db, GBIS_COLLIDING_ROUTE_ID);
		expect(seoul?.route?.name).toBe("서초03");
		const gbis = await findBusRouteStops(db, `gbis:${GBIS_COLLIDING_ROUTE_ID}`);
		expect(gbis?.route?.name).toBe("충돌");
	});

	test("does not find a GBIS route without its prefix", async () => {
		expect((await findBusRouteStops(db, GBIS_ROUTE_ID))?.route).toBeNull();
	});

	test("returns null for a route that only exists in an old batch", async () => {
		expect((await findBusRouteStops(db, OLD_ONLY_ROUTE_ID))?.route).toBeNull();
	});

	test("returns null for an unknown route", async () => {
		expect((await findBusRouteStops(db, "nope"))?.route).toBeNull();
	});
});

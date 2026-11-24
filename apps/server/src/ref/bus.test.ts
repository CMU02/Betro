import { SOURCE_TIMEZONE } from "@Betro/commute/sources/seoul-bus";
import { and, eq } from "@Betro/db/operators";
import { busRoute, busRouteStop } from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { beforeAll, describe, expect, test } from "bun:test";
import { findBusRouteStops, findStopRoutes, searchBusRoutes } from "./bus";
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
	test("lists same-numbered GBIS village buses apart by area name, then a Seoul route containing the query", async () => {
		const result = await searchBusRoutes(db, { limit: 20, q: "11" });
		expect(
			result?.routes.map(({ areaName, line }) => ({ areaName, line }))
		).toEqual([
			{ areaName: "성남", line: `gbis:${GBIS_ROUTE_ID}` },
			{ areaName: "수원", line: `gbis:${GBIS_OTHER_ROUTE_ID}` },
			{ areaName: null, line: "seoul-bus:100100004" },
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

describe("findStopRoutes", () => {
	let stopDb: Db;

	beforeAll(async () => {
		stopDb = await createTestDb();
		await seedBusReference(stopDb);
		// 100100001(1000)에 배차간격을 주고, 같은 정류장 S2를 지나는 두 번째 서울 노선(100)을 더한다.
		await stopDb
			.update(busRoute)
			.set({ firstBusMinute: 300, headwayMin: 8, lastBusMinute: 1400 })
			.where(
				and(eq(busRoute.routeId, "100100001"), eq(busRoute.source, "seoul"))
			);
		const [hundred] = await stopDb
			.select({ id: busRoute.id })
			.from(busRoute)
			.where(
				and(eq(busRoute.routeId, "100100003"), eq(busRoute.source, "seoul"))
			);
		if (!hundred) {
			throw new Error("seed route missing");
		}
		await stopDb.insert(busRouteStop).values(
			[
				{ name: "둘째", seq: 5, stationId: "S2" },
				{ name: "종점", seq: 6, stationId: "S9" },
			].map((stop) => ({
				...stop,
				apiSectDistM: 0,
				arsId: "01002",
				busRouteId: hundred.id,
				directionName: null,
				distanceM: 0,
				lat: 37.5,
				lng: 127,
				offsetM: 0,
				qualityFlags: [],
			}))
		);
	});

	test("정류장 노선은 서울 노선만이고 다음 정류장 이름과 배차 정보를 준다", async () => {
		const found = await findStopRoutes(stopDb, "seoul-bus:S2");
		expect(found?.result?.stop).toBe("seoul-bus:S2");
		expect(found?.result?.timezone).toBe(SOURCE_TIMEZONE);
		expect(
			found?.result?.routes.map((r) => [
				r.shortName,
				r.seq,
				r.nextStopName,
				r.headwayMin,
			])
		).toEqual([
			["100", 5, "종점", null],
			["1000", 2, "셋째", 8],
		]);
		expect(found?.result?.routes[1]).toMatchObject({
			firstBusMinute: 300,
			lastBusMinute: 1400,
			line: "seoul-bus:100100001",
		});
	});

	test("gbis 정류장 ref와 gbis만 지나는 정류장은 없다", async () => {
		expect((await findStopRoutes(stopDb, "gbis:S1"))?.result).toBeNull();
		expect((await findStopRoutes(stopDb, "seoul-bus:G2"))?.result).toBeNull();
		// 서울 노선과 gbis 노선이 함께 지나도 서울 노선만 나온다.
		const shared = await findStopRoutes(stopDb, "seoul-bus:S1");
		expect(shared?.result?.routes.map((r) => r.line)).toEqual([
			"seoul-bus:100100001",
		]);
	});

	test("배차간격이 없는 노선은 headwayMin이 null이고 마지막 정류장은 다음 정류장이 없다", async () => {
		const found = await findStopRoutes(stopDb, "seoul-bus:S9");
		expect(found?.result?.routes[0]?.headwayMin).toBeNull();
		expect(found?.result?.routes[0]?.nextStopName).toBeNull();
	});
});

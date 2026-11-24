import {
	type BusRegion,
	type BusSource,
	busRoute,
	busRouteShape,
	referenceBatch,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import {
	gbisPositionUrl,
	parseRegionalPositions,
	tagoPositionUrl,
} from "@Betro/realtime/upstream/regional-position";
import { describe, expect, test } from "bun:test";
import { d1Over } from "../test-d1";
import { D1ReferenceSource, fixtureUpstream } from "./cf-ports";

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

describe("D1ReferenceSource.loadBus regional keys", () => {
	test("출처를 붙인 키는 그 출처의 행에서 읽고, TAGO 도시 코드와 GBIS 모양을 싣는다", async () => {
		const db = await createTestDb();
		const [current] = await db
			.insert(referenceBatch)
			.values({ isCurrent: true, kind: "bus_route", sourceManifest: {} })
			.returning({ id: referenceBatch.id });
		if (!current) {
			throw new Error("seed batch missing");
		}
		const row = (
			origin: BusSource,
			region: BusRegion,
			routeId: string,
			sourceCity: string | null = null
		) => ({
			batchId: current.id,
			qualityFlags: [],
			region,
			routeId,
			routeName: routeId,
			routeType: "3",
			shortName: routeId,
			source: origin,
			sourceCity,
		});
		const [seoul, gbis, tago] = await db
			.insert(busRoute)
			.values([
				row("seoul", "seoul", "100100001"),
				row("gbis", "gyeonggi", "100100001"),
				row("tago", "incheon", "ICB361000005", "23"),
			])
			.returning({ id: busRoute.id });
		if (!(seoul && gbis && tago)) {
			throw new Error("seed route missing");
		}
		const coords: [number, number][] = [
			[127, 37.5],
			[127.001, 37.5],
		];
		await db.insert(busRouteShape).values([
			{ attribution: "t", busRouteId: seoul.id, coords, lengthM: 111 },
			{ attribution: "t", busRouteId: gbis.id, coords, lengthM: 222 },
			{ attribution: "t", busRouteId: tago.id, coords, lengthM: 333 },
		]);

		const reference = new D1ReferenceSource(d1Over(db));
		const { routes } = await reference.loadBus(
			["100100001", "gbis:100100001", "tago:ICB361000005", "tago:ICB9"],
			false
		);
		expect([...routes.keys()].sort()).toEqual([
			"100100001",
			"gbis:100100001",
			"tago:ICB361000005",
		]);
		expect(routes.get("100100001")?.lengthM).toBe(111);
		expect(routes.get("100100001")?.coords).toBeUndefined();
		const gbisRef = routes.get("gbis:100100001");
		expect(gbisRef?.lengthM).toBe(222);
		expect(gbisRef?.routeId).toBe("gbis:100100001");
		// GBIS 위치에는 좌표가 없어 모양 없이는 지도에 놓지 못한다.
		expect(gbisRef?.coords).toEqual(coords);
		expect(gbisRef?.cityCode).toBeUndefined();
		expect(routes.get("tago:ICB361000005")?.cityCode).toBe("23");
	});
});

describe("fixtureUpstream regional", () => {
	test("GBIS·TAGO 위치 URL에는 regional 표본을 돌려준다", async () => {
		const gbis = await fixtureUpstream.fetch(gbisPositionUrl("k", "200000037"));
		expect(
			parseRegionalPositions("gbis", gbis.status ?? 0, gbis.body).outcome
		).toBe("ok");
		const tago = await fixtureUpstream.fetch(
			tagoPositionUrl("k", "23", "ICB361000005")
		);
		expect(
			parseRegionalPositions("tago", tago.status ?? 0, tago.body).outcome
		).toBe("ok");
		const other = await fixtureUpstream.fetch(gbisPositionUrl("k", "1"));
		expect(
			parseRegionalPositions("gbis", other.status ?? 0, other.body).outcome
		).toBe("no-data");
	});
});

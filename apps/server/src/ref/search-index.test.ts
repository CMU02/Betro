import { createAuth } from "@Betro/auth";
import type { LibsqlDatabase } from "@Betro/db";
import { and, eq } from "@Betro/db/operators";
import {
	busRoute,
	busRouteStop,
	referenceBatch,
	stationCrosswalk,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../app";
import { groupStations, STATION_GROUP_RADIUS_M } from "./search-index";
import { seedBusReference } from "./test-seed";

const API_HOST = "betro.cmu02-studio.com";
const API = `https://${API_HOST}`;
const TEST_SECRET = "test-secret-test-secret-test-secret-0123";

const GANGNAM_SHINBUNDANG = {
	lat: 37.4966,
	line: "seoul-subway:shinbundang",
	lng: 127.0283,
	name: "강남",
	stop: "seoul-subway:1077000687",
};
const GANGNAM_LINE2 = {
	lat: 37.4979,
	line: "seoul-subway:line2",
	lng: 127.0276,
	name: "강남",
	stop: "seoul-subway:1002000222",
};
const YANGPYEONG_GYEONGUI = {
	lat: 37.4925,
	line: "seoul-subway:gyeongui-jungang",
	lng: 127.4917,
	name: "양평",
	stop: "seoul-subway:1063075131",
};
const YANGPYEONG_LINE5 = {
	lat: 37.5257,
	line: "seoul-subway:line5",
	lng: 126.8865,
	name: "양평",
	stop: "seoul-subway:1005000522",
};

function buildApp(db: LibsqlDatabase) {
	return createApp({
		apiHost: API_HOST,
		auth: createAuth(
			{
				BETTER_AUTH_SECRET: TEST_SECRET,
				BETTER_AUTH_URL: API,
				CORS_ORIGIN: "http://localhost:8081",
			},
			db
		),
		corsOrigins: ["http://localhost:8081"],
		db,
		statusHost: "betro-status.cmu02-studio.com",
	});
}

describe("groupStations", () => {
	test("같은 이름이 700m 안이면 한 역이고 멀면 따로다", () => {
		const groups = groupStations([
			GANGNAM_SHINBUNDANG,
			GANGNAM_LINE2,
			YANGPYEONG_GYEONGUI,
			YANGPYEONG_LINE5,
		]);
		expect(STATION_GROUP_RADIUS_M).toBe(700);
		expect(groups.map((g) => [g.name, g.members.length])).toEqual([
			["강남", 2],
			["양평", 1],
			["양평", 1],
		]);
		expect(groups[0]?.key).toBe(
			"seoul-subway:1002000222,seoul-subway:1077000687"
		);
	});

	test("입력 순서가 바뀌어도 묶음과 키가 같다", () => {
		const rows = [
			GANGNAM_SHINBUNDANG,
			GANGNAM_LINE2,
			YANGPYEONG_GYEONGUI,
			YANGPYEONG_LINE5,
		];
		const forward = groupStations(rows);
		const backward = groupStations(rows.slice().reverse());
		expect(backward).toEqual(forward);
	});
});

describe("GET /v1/ref/search-index", () => {
	let app: ReturnType<typeof createApp>;
	let emptyApp: ReturnType<typeof createApp>;
	let countedApp: ReturnType<typeof createApp>;
	let selectCount = 0;
	let busBatchId: number;
	let crosswalkBatchId: number;

	beforeAll(async () => {
		const db = await createTestDb();
		({ currentBatchId: busBatchId } = await seedBusReference(db));
		// 서울 출처지만 경기 면허(region gyeonggi)인 노선에만 서는 정류장을 더한다.
		const [gyeonggiLicensed] = await db
			.select({ id: busRoute.id })
			.from(busRoute)
			.where(
				and(eq(busRoute.routeId, "200000001"), eq(busRoute.source, "seoul"))
			);
		if (!gyeonggiLicensed) {
			throw new Error("seed route missing");
		}
		await db.insert(busRouteStop).values({
			apiSectDistM: 0,
			arsId: null,
			busRouteId: gyeonggiLicensed.id,
			directionName: null,
			distanceM: 0,
			lat: 37.3,
			lng: 127.2,
			name: "경기면허전용",
			offsetM: 0,
			qualityFlags: [],
			seq: 1,
			stationId: "ONLY-GG",
		});
		// 서울 노선 하나가 같은 정류장 S2를 다른 방향으로 지나게 해 towards 집계를 본다.
		const [seoulSecond] = await db
			.select({ id: busRoute.id })
			.from(busRoute)
			.where(
				and(eq(busRoute.routeId, "100100003"), eq(busRoute.source, "seoul"))
			);
		const [seoulThird] = await db
			.select({ id: busRoute.id })
			.from(busRoute)
			.where(
				and(eq(busRoute.routeId, "100100004"), eq(busRoute.source, "seoul"))
			);
		if (!(seoulSecond && seoulThird)) {
			throw new Error("seed route missing");
		}
		const extra = (
			busRouteId: number,
			seq: number,
			stationId: string,
			name: string
		) => ({
			apiSectDistM: 0,
			arsId: null,
			busRouteId,
			directionName: null,
			distanceM: 0,
			lat: 37.5,
			lng: 127,
			name,
			offsetM: 0,
			qualityFlags: [],
			seq,
			stationId,
		});
		// 100번: S2 다음 X, 110A: S2 다음 X, 1000번(시드): S2 다음 S3(셋째). X가 2대 1로 이긴다.
		await db
			.insert(busRouteStop)
			.values([
				extra(seoulSecond.id, 1, "S2", "둘째"),
				extra(seoulSecond.id, 2, "X1", "엑스"),
				extra(seoulThird.id, 1, "S2", "둘째"),
				extra(seoulThird.id, 2, "X1", "엑스"),
			]);
		const [crosswalk] = await db
			.insert(referenceBatch)
			.values({
				isCurrent: true,
				kind: "station_crosswalk",
				sourceManifest: {},
			})
			.returning({ id: referenceBatch.id });
		if (!crosswalk) {
			throw new Error("seed batch missing");
		}
		crosswalkBatchId = crosswalk.id;
		const subwayRows = [
			{ ...GANGNAM_SHINBUNDANG, lineKey: "shinbundang" },
			{ ...GANGNAM_LINE2, lineKey: "line2" },
			{ ...YANGPYEONG_GYEONGUI, lineKey: "gyeongui-jungang" },
			{ ...YANGPYEONG_LINE5, lineKey: "line5" },
		];
		await db.insert(stationCrosswalk).values(
			subwayRows.map((row) => ({
				batchId: crosswalk.id,
				coordSource: "test",
				lat: row.lat,
				lineKey: row.lineKey,
				lng: row.lng,
				matchMethod: "auto-same-line" as const,
				nameAliases: [],
				nameCanonical: row.name,
				qualityFlags: [],
				statnId: row.stop.replace("seoul-subway:", ""),
				subwayId: "0",
			}))
		);
		app = buildApp(db);
		// select 호출 횟수를 세는 db. 배치 조회만 하는지 본다.
		countedApp = buildApp(
			new Proxy(db, {
				get(target, prop, receiver) {
					if (prop === "select") {
						return (...args: unknown[]) => {
							selectCount += 1;
							return Reflect.apply(target.select, target, args);
						};
					}
					return Reflect.get(target, prop, receiver);
				},
			})
		);
		emptyApp = buildApp(await createTestDb());
	});

	const get = (
		a: ReturnType<typeof createApp>,
		headers: Record<string, string> = {}
	) => a.request(`${API}/v1/ref/search-index`, { headers });

	test("색인에는 서울 노선과 마을버스만 있고 경기·인천 노선과 그 정류장은 없다", async () => {
		const res = await get(app);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		const body = (await res.json()) as {
			routes: { line: string; routeType: string }[];
			stations: { name: string }[];
			stops: { name: string; stop: string }[];
		};
		// 경기 면허(200000001)와 gbis 노선은 빠지고, 순서는 shortName, routeId다.
		expect(body.routes.map((r) => r.line)).toEqual([
			"seoul-bus:100100003",
			"seoul-bus:100100001",
			"seoul-bus:100100004",
			"seoul-bus:100100002",
		]);
		const stopRefs = body.stops.map((s) => s.stop);
		expect(stopRefs).not.toContain("seoul-bus:ONLY-GG");
		expect(stopRefs).not.toContain("seoul-bus:G2");
		expect(stopRefs.every((s) => s.startsWith("seoul-bus:"))).toBe(true);
		expect(body.stations.map((s) => s.name)).toEqual(["강남", "양평", "양평"]);
	});

	test("towards는 가장 많은 노선의 다음 정류장 이름이다", async () => {
		const body = (await (await get(app)).json()) as {
			stops: { name: string; towards: string | null }[];
		};
		const byName = new Map(body.stops.map((s) => [s.name, s.towards]));
		expect(byName.get("둘째")).toBe("엑스");
		// 모든 노선에서 마지막 정류장이면 null
		expect(byName.get("셋째")).toBeNull();
		expect(byName.get("엑스")).toBeNull();
	});

	test("ETag가 맞으면 304이고 배치가 없으면 503이다", async () => {
		const first = await get(app);
		const etag = first.headers.get("etag");
		expect(etag).toBe(`"search-${crosswalkBatchId}-${busBatchId}"`);
		const second = await get(app, { "if-none-match": etag ?? "" });
		expect(second.status).toBe(304);
		expect((await get(emptyApp)).status).toBe(503);
	});

	test("ETag가 맞으면 배치 ID 두 번만 조회하고 색인은 만들지 않는다", async () => {
		const etag = (await get(countedApp)).headers.get("etag") ?? "";
		selectCount = 0;
		const res = await get(countedApp, { "if-none-match": etag });
		expect(res.status).toBe(304);
		expect(selectCount).toBe(2);
	});

	test("같은 배치의 200 응답은 isolate 메모리의 색인을 재사용한다", async () => {
		const first = await get(countedApp);
		const firstBody = await first.text();
		selectCount = 0;
		const second = await get(countedApp);
		expect(second.status).toBe(200);
		expect(await second.text()).toBe(firstBody);
		expect(selectCount).toBe(2);
	});
});

import {
	busRoute,
	referenceBatch,
	timetableStopTime,
	timetableTrip,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { kstToEpochMs } from "@Betro/realtime/time";
import { beforeAll, describe, expect, it } from "bun:test";
import gbisArrivalBoard from "../../../../packages/commute/src/sources/__fixtures__/regional/gbis-arrival-board.json";
import gbisLocation from "../../../../packages/commute/src/sources/__fixtures__/regional/gbis-location.json";
import tagoGateway04 from "../../../../packages/commute/src/sources/__fixtures__/regional/tago-gateway-04.json";
import type { Upstream } from "../collector/ports";
import { d1Over } from "../test-d1";
import type { Env } from "../worker-env";
import {
	D1Timetable,
	readBusSchedules,
	readRegionalRouteCities,
	regionalBoardSource,
	runnerConfig,
} from "./cf-ports";
import { UpstreamStoppedError } from "./ports";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

const route = (
	routeId: string,
	schedule: {
		firstBusMinute?: number | null;
		headwayMin?: number | null;
		lastBusMinute?: number | null;
	}
) => ({
	qualityFlags: [],
	region: "seoul" as const,
	routeId,
	routeName: routeId,
	routeType: "3",
	shortName: routeId,
	...schedule,
});

beforeAll(async () => {
	db = await createTestDb();
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
	await db.insert(busRoute).values([
		{
			...route("100100118", {
				firstBusMinute: 200,
				headwayMin: 20,
				lastBusMinute: 1300,
			}),
			batchId: old.id,
		},
		{ ...route("999000001", { headwayMin: 9 }), batchId: old.id },
		{
			...route("100100118", {
				firstBusMinute: 270,
				headwayMin: 13,
				lastBusMinute: 1370,
			}),
			batchId: current.id,
		},
		{
			...route("100100290", {
				firstBusMinute: 240,
				headwayMin: 8,
				lastBusMinute: 60,
			}),
			batchId: current.id,
		},
		{ ...route("100100001", { headwayMin: null }), batchId: current.id },
		{ ...route("100100002", { headwayMin: 0 }), batchId: current.id },
		// 서울 6411과 노선 ID가 같은 GBIS 노선. 출처로 구분한다.
		{
			...route("100100290", { headwayMin: 15 }),
			areaName: "고양",
			batchId: current.id,
			region: "gyeonggi" as const,
			source: "gbis" as const,
		},
		{
			...route("ICB165000012", { headwayMin: 25 }),
			areaName: "인천",
			batchId: current.id,
			region: "incheon" as const,
			source: "tago" as const,
			sourceCity: "23",
		},
	]);
});

describe("readBusSchedules", () => {
	it("reads headway and first/last bus from the current batch", async () => {
		expect(
			await readBusSchedules(db, [
				"seoul-bus:100100118",
				"seoul-bus:100100290",
				"seoul-bus:123456789",
			])
		).toEqual({
			"seoul-bus:100100118": {
				firstBusMinute: 270,
				headwayMin: 13,
				lastBusMinute: 1370,
			},
			"seoul-bus:100100290": {
				firstBusMinute: 240,
				headwayMin: 8,
				lastBusMinute: 60,
			},
		});
	});

	it("reads each source's row by (source, route id) and keys it by the full line ref", async () => {
		expect(
			await readBusSchedules(db, [
				"gbis:100100290",
				"tago:ICB165000012",
				"gbis:ICB165000012",
			])
		).toEqual({
			"gbis:100100290": {
				firstBusMinute: null,
				headwayMin: 15,
				lastBusMinute: null,
			},
			"tago:ICB165000012": {
				firstBusMinute: null,
				headwayMin: 25,
				lastBusMinute: null,
			},
		});
	});

	it("leaves out routes only in an old batch and routes without a headway", async () => {
		expect(
			await readBusSchedules(db, [
				"seoul-bus:999000001",
				"seoul-bus:100100001",
				"seoul-bus:100100002",
			])
		).toEqual({});
	});

	it("does not query for an empty list", async () => {
		expect(await readBusSchedules(db, [])).toEqual({});
	});
});

describe("readRegionalRouteCities", () => {
	it("regionalRouteCities는 tago 노선의 source_city를 읽는다", async () => {
		expect(
			await readRegionalRouteCities(db, [
				"tago:ICB165000012",
				"gbis:100100290",
				"tago:ICB000000000",
			])
		).toEqual({
			"gbis:100100290": null,
			"tago:ICB000000000": null,
			"tago:ICB165000012": "23",
		});
	});
});

describe("regionalBoardSource", () => {
	const AT = 1_800_000_000_000;
	const KEY = "TEST-REGIONAL-KEY-0123456789";
	const GBIS = {
		cityCode: null,
		routeId: "200000037",
		source: "gbis" as const,
	};
	const TAGO = {
		cityCode: "23",
		routeId: "ICB361000005",
		source: "tago" as const,
	};
	const STOP = { seq: 15, stopId: "202000224" };

	function upstreamOf(response: {
		body: string;
		status: number | null;
	}): Upstream & { urls: string[] } {
		const urls: string[] = [];
		return {
			fetch: (url) => {
				urls.push(url);
				return Promise.resolve(response);
			},
			urls,
		};
	}

	const gatewayBody = (code: string) =>
		JSON.stringify({
			OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: code } },
		});

	it("GBIS 도착과 위치 목록을 https 주소로 한 번씩 불러 읽는다", async () => {
		const arrivalUpstream = upstreamOf(gbisArrivalBoard);
		const arrival = await regionalBoardSource(
			arrivalUpstream,
			KEY,
			() => AT
		).regionalArrival(GBIS, STOP);
		expect(arrival?.madeAt).toBe(AT);
		expect(arrival?.vehicles.map((v) => [v.vehicleId, v.seqNow])).toEqual([
			["200011170", 12],
			["200010795", 8],
		]);
		expect(arrivalUpstream.urls).toHaveLength(1);
		expect(
			arrivalUpstream.urls[0]?.startsWith("https://apis.data.go.kr/")
		).toBe(true);
		const positions = await regionalBoardSource(
			upstreamOf(gbisLocation),
			KEY,
			() => AT
		).regionalLocations(GBIS);
		expect(positions?.find((p) => p.vehicleId === "200011170")?.seq).toBe(12);
	});

	it("TAGO 게이트웨이 04와 응답 없음은 null, 22는 그 출처의 quota 멈춤, 30은 auth 멈춤이다", async () => {
		const sourceOf = (response: { body: string; status: number | null }) =>
			regionalBoardSource(upstreamOf(response), KEY, () => AT);
		expect(await sourceOf(tagoGateway04).regionalLocations(TAGO)).toBeNull();
		expect(
			await sourceOf(tagoGateway04).regionalArrival(TAGO, STOP)
		).toBeNull();
		expect(
			await sourceOf({ body: "", status: null }).regionalArrival(TAGO, STOP)
		).toBeNull();
		const quota = await sourceOf({ body: gatewayBody("22"), status: 200 })
			.regionalArrival(TAGO, STOP)
			.catch((error: unknown) => error);
		expect(quota).toBeInstanceOf(UpstreamStoppedError);
		expect(quota).toMatchObject({ outcome: "quota-exhausted", source: "tago" });
		const auth = await sourceOf({ body: gatewayBody("30"), status: 200 })
			.regionalLocations(GBIS)
			.catch((error: unknown) => error);
		expect(auth).toMatchObject({ outcome: "auth", source: "gbis" });
	});

	it("XML 게이트웨이 오류도 같은 표로 나눈다", async () => {
		const xml = (code: string) =>
			`<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
		const source = (code: string) =>
			regionalBoardSource(
				upstreamOf({ body: xml(code), status: 200 }),
				KEY,
				() => AT
			);
		expect(await source("04").regionalLocations(TAGO)).toBeNull();
		const stopped = await source("22")
			.regionalLocations(TAGO)
			.catch((error: unknown) => error);
		expect(stopped).toMatchObject({
			outcome: "quota-exhausted",
			source: "tago",
		});
	});

	it("차량이 없는 응답은 null이 아니라 빈 도착·빈 목록이다", async () => {
		const empty = JSON.stringify({
			response: {
				body: { items: "", numOfRows: 20, pageNo: 1, totalCount: 0 },
				header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
			},
		});
		const source = regionalBoardSource(
			upstreamOf({ body: empty, status: 200 }),
			KEY,
			() => AT
		);
		expect(await source.regionalArrival(TAGO, STOP)).toEqual({
			headwayMin: null,
			madeAt: AT,
			seq: STOP.seq,
			stopId: STOP.stopId,
			vehicles: [],
		});
		expect(await source.regionalLocations(TAGO)).toEqual([]);
	});

	it("도시 코드가 없는 TAGO 노선은 부르지 않는다", async () => {
		const upstream = upstreamOf({ body: "", status: 200 });
		const source = regionalBoardSource(upstream, KEY, () => AT);
		expect(
			await source.regionalArrival({ ...TAGO, cityCode: null }, STOP)
		).toBeNull();
		expect(upstream.urls).toEqual([]);
	});
});

describe("runnerConfig", () => {
	it("지역 버스 예산 환경 변수(DAILY_BUDGET_*)를 실행기 설정에 넘긴다", () => {
		const config = runnerConfig({
			COMMUTE_TICK_MS: "5000",
			DAILY_BUDGET_GBIS_ARRIVAL: "11",
			DAILY_BUDGET_GBIS_LOCATION_RUNNER: "12",
			DAILY_BUDGET_TAGO_ARRIVAL: "13",
			DAILY_BUDGET_TAGO_LOCATION_RUNNER: "14",
		} as unknown as Env);
		expect(config.tickMs).toBe(5000);
		expect(config.dailyBudgetGbisArrival).toBe(11);
		expect(config.dailyBudgetGbisLocation).toBe(12);
		expect(config.dailyBudgetTagoArrival).toBe(13);
		expect(config.dailyBudgetTagoLocation).toBe(14);
	});
});

describe("D1Timetable.firstLast", () => {
	const SECOND_MS = 1000;
	const NOON = kstToEpochMs("2026-11-24 12:00:00");
	const DAY_START = kstToEpochMs("2026-11-24 00:00:00");
	let timetable: D1Timetable;

	beforeAll(async () => {
		const tdb = await createTestDb();
		const [old, current] = await tdb
			.insert(referenceBatch)
			.values([
				{ isCurrent: false, kind: "timetable", sourceManifest: {} },
				{ isCurrent: true, kind: "timetable", sourceManifest: {} },
			])
			.returning({ id: referenceBatch.id });
		if (!(old && current)) {
			throw new Error("seed batches missing");
		}
		const trip = (
			batchId: number,
			trainNo: string,
			direction: "up" | "down",
			serviceDay: "weekday" | "saturday"
		) => ({
			batchId,
			direction,
			express: "local" as const,
			lineKey: "line2",
			qualityFlags: [],
			serviceDay,
			serviceDaySource: "source" as const,
			source: "seoul-metro-csv" as const,
			sourceVersion: "test",
			trainNo,
		});
		const trips = await tdb
			.insert(timetableTrip)
			.values([
				trip(current.id, "first", "up", "weekday"),
				trip(current.id, "last", "up", "weekday"),
				trip(current.id, "down", "down", "weekday"),
				trip(current.id, "sat", "up", "saturday"),
				trip(old.id, "old", "up", "weekday"),
			])
			.returning({ id: timetableTrip.id });
		const [first, last, down, sat, oldTrip] = trips.map((row) => row.id);
		const stop = (
			tripId: number | undefined,
			arriveSec: number | null,
			departSec: number | null
		) => {
			if (tripId === undefined) {
				throw new Error("seed trip missing");
			}
			return {
				arriveSec,
				departSec,
				qualityFlags: [],
				seq: 1,
				statnId: "1002000222",
				tripId,
			};
		};
		// 마지막 열차는 이 역이 종점이라 출발 시각이 없다(도착 25:00).
		await tdb
			.insert(timetableStopTime)
			.values([
				stop(first, 19_770, 19_800),
				stop(last, 90_000, null),
				stop(down, 18_000, 18_000),
				stop(sat, 18_000, 18_000),
				stop(oldTrip, 10_000, 10_000),
			]);
		timetable = new D1Timetable(d1Over(tdb));
	});

	it("D1Timetable.firstLast는 그 서비스일 그 방향의 첫·마지막 시각이고 depart가 null인 종점은 arrive를 쓴다", async () => {
		expect(
			await timetable.firstLast("line2", "up", "1002000222", NOON)
		).toEqual({
			firstAt: DAY_START + 19_800 * SECOND_MS,
			lastAt: DAY_START + 90_000 * SECOND_MS,
		});
	});

	it("시간표가 없는 역은 둘 다 null이다", async () => {
		expect(
			await timetable.firstLast("line2", "up", "1002000999", NOON)
		).toEqual({ firstAt: null, lastAt: null });
	});
});

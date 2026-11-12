import { describe, expect, it } from "bun:test";
import arrivals150 from "../__fixtures__/arr-all-150.json";
import arrivals6411 from "../__fixtures__/arr-all-6411.json";
import { localToEpochMs } from "../calendar";
import { DEFAULT_TIMEZONE } from "../config";
import {
	busBoards,
	parseRouteArrivals,
	type RouteStopArrival,
	routeArrivalsUrl,
} from "./seoul-bus";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 6411 표본의 mkTm "2026-11-10 13:48:42.0" */
const MADE_6411 =
	localToEpochMs("2026-11-10", 13 * 60 + 48, DEFAULT_TIMEZONE) + 42 * SECOND_MS;
/** 150 표본의 mkTm "2026-11-10 14:38:58.0" */
const MADE_150 =
	localToEpochMs("2026-11-10", 14 * 60 + 38, DEFAULT_TIMEZONE) + 58 * SECOND_MS;
const FETCHED_6411 = MADE_6411 + 3 * SECOND_MS;
const VEHICLE_A = "103055116";
const VEHICLE_B = "103055077";

function stopsOf(json: unknown): RouteStopArrival[] {
	const parsed = parseRouteArrivals(json);
	if (!parsed.ok) {
		throw new Error(`fixture did not parse: ${parsed.headerCd}`);
	}
	return parsed.stops;
}

const stops6411 = stopsOf(arrivals6411);
const stops150 = stopsOf(arrivals150);

function stopAt(stops: RouteStopArrival[], seq: number): RouteStopArrival {
	const found = stops.find((entry) => entry.seq === seq);
	if (!found) {
		throw new Error(`no stop at seq ${seq}`);
	}
	return found;
}

function vehicle(
	vehicleId: string,
	seqNow: number,
	etaSec: number,
	overrides: Partial<RouteStopArrival["vehicles"][number]> = {}
): RouteStopArrival["vehicles"][number] {
	return {
		etaSec,
		isArrived: false,
		lastOfDay: false,
		plate: `plate-${vehicleId}`,
		seqNow,
		vehicleId,
		...overrides,
	};
}

function stop(
	seq: number,
	vehicles: RouteStopArrival["vehicles"],
	madeAt = MADE_6411
): RouteStopArrival {
	return { headwayMin: 10, madeAt, seq, stopId: `stop-${seq}`, vehicles };
}

describe("parseRouteArrivals", () => {
	it("reads every stop of the 6411 sample", () => {
		const parsed = parseRouteArrivals(arrivals6411);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			return;
		}
		expect(parsed.fetchedHeaderCd).toBe("0");
		expect(parsed.stops).toHaveLength(117);
		const stop39 = stopAt(parsed.stops, 39);
		expect(stop39.stopId).toBe("119000011");
		expect(stop39.headwayMin).toBe(12);
		expect(stop39.madeAt).toBe(MADE_6411);
		expect(stop39.vehicles).toEqual([
			{
				etaSec: 208,
				isArrived: false,
				lastOfDay: false,
				plate: "서울70사5909",
				seqNow: 37,
				vehicleId: VEHICLE_A,
			},
			{
				etaSec: 1198,
				isArrived: false,
				lastOfDay: false,
				plate: "서울74사8881",
				seqNow: 27,
				vehicleId: VEHICLE_B,
			},
		]);
	});

	it("leaves out empty vehicle slots", () => {
		expect(stopAt(stops6411, 1).vehicles).toEqual([]);
	});

	it("treats headerCd 4 as an empty success", () => {
		expect(
			parseRouteArrivals({
				msgBody: { itemList: null },
				msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." },
			})
		).toEqual({ fetchedHeaderCd: "4", ok: true, stops: [] });
	});

	it("reports other header codes as failures", () => {
		expect(
			parseRouteArrivals({
				msgBody: { itemList: null },
				msgHeader: { headerCd: "7", headerMsg: "인증 실패" },
			})
		).toEqual({ headerCd: "7", ok: false });
	});

	it("reports bodies that are not JSON envelopes without a header code", () => {
		expect(parseRouteArrivals("<OpenAPI_ServiceResponse>")).toEqual({
			headerCd: null,
			ok: false,
		});
		expect(parseRouteArrivals(undefined)).toEqual({
			headerCd: null,
			ok: false,
		});
		expect(parseRouteArrivals({ unexpected: true })).toEqual({
			headerCd: null,
			ok: false,
		});
	});
});

describe("routeArrivalsUrl", () => {
	it("asks for one route in JSON", () => {
		expect(routeArrivalsUrl("k+y/=", "100100290")).toBe(
			"http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=k%2By%2F%3D&busRouteId=100100290&resultType=json"
		);
	});
});

describe("busBoards.board", () => {
	it("turns the two approaching vehicles into official arrivals", () => {
		const board = busBoards(null, stops6411, FETCHED_6411).board(39);
		expect(board).toEqual({
			approaching: [
				{
					etaAt: MADE_6411 + 208 * SECOND_MS,
					lastOfDay: false,
					method: "official",
					plate: "서울70사5909",
					stopsAway: 39 - 37,
					vehicleId: VEHICLE_A,
				},
				{
					etaAt: MADE_6411 + 1198 * SECOND_MS,
					lastOfDay: false,
					method: "official",
					plate: "서울74사8881",
					stopsAway: 39 - 27,
					vehicleId: VEHICLE_B,
				},
			],
			fetchedAt: FETCHED_6411,
			headwayMs: 12 * MINUTE_MS,
			passed: [],
			sourceAt: MADE_6411,
		});
	});

	it("counts a vehicle at the stop or arriving as zero stops away", () => {
		const atStop = busBoards(null, stops150, MADE_150).board(40);
		expect(atStop.approaching[0]?.stopsAway).toBe(0);
		expect(atStop.approaching[0]?.etaAt).toBe(MADE_150 + 5 * SECOND_MS);
		const arriving = busBoards(
			null,
			[stop(5, [vehicle("V", 3, 20, { isArrived: true })])],
			MADE_6411
		).board(5);
		expect(arriving.approaching[0]?.stopsAway).toBe(0);
	});

	it("lists a vehicle that has gone past the stop as passed", () => {
		const nowMade = MADE_6411 + MINUTE_MS;
		// A가 순번 40으로 옮겨 갔다. 40까지의 정류장 목록에서 빠지고 41부터는 순번 40으로 나온다.
		const now = stops6411.map((entry) => ({
			...entry,
			madeAt: nowMade,
			vehicles: entry.vehicles
				.filter((v) => v.vehicleId !== VEHICLE_A || entry.seq > 40)
				.map((v) => (v.vehicleId === VEHICLE_A ? { ...v, seqNow: 40 } : v)),
		}));
		expect(stopAt(now, 41).vehicles[0]?.vehicleId).toBe(VEHICLE_A);
		const board = busBoards(stops6411, now, nowMade).board(39);
		expect(board.passed).toEqual([{ at: nowMade, vehicleId: VEHICLE_A }]);
		expect(board.approaching.map((a) => a.vehicleId)).toEqual([VEHICLE_B]);
		// 지난 차량은 직전 응답과 지금 응답 사이에 정류장을 지났다.
		expect(board.prevSourceAt).toBe(MADE_6411);
		expect(
			busBoards(null, now, nowMade).board(39).prevSourceAt
		).toBeUndefined();
	});

	it("does not call a vehicle passed when it is still behind the stop", () => {
		const prev = [stop(5, [vehicle("V", 2, 120), vehicle("W", 1, 300)])];
		const now = [
			stop(5, [vehicle("X", 3, 60), vehicle("V", 2, 100)]),
			stop(3, [vehicle("W", 1, 90)]),
		];
		expect(busBoards(prev, now, MADE_6411).board(5).passed).toEqual([]);
	});
});

describe("busBoards.progress", () => {
	it("uses the alighting stop's official arrival when the vehicle is listed", () => {
		expect(
			busBoards(null, stops6411, FETCHED_6411).progress(VEHICLE_A, 42)
		).toEqual({
			etaAt: MADE_6411 + 544 * SECOND_MS,
			method: "official",
			stopsAway: 42 - 37,
		});
	});

	it("extrapolates from the farthest stop that lists the vehicle first", () => {
		// V는 순번 1에 있고 순번 2·3에서 첫 차량이다. 순번 5에는 앞선 U·W만 나온다.
		const stops = [
			stop(2, [vehicle("V", 1, 60)]),
			stop(3, [vehicle("V", 1, 120)]),
			stop(4, [vehicle("W", 3, 30), vehicle("V", 1, 200)]),
			stop(5, [vehicle("U", 4, 40), vehicle("W", 3, 100)]),
		];
		// 정류장당 평균 120초 / (3 - 1) = 60초, 남은 정류장 5 - 3 = 2
		expect(busBoards(null, stops, MADE_6411).progress("V", 5)).toEqual({
			etaAt: MADE_6411 + (120 + 2 * 60) * SECOND_MS,
			method: "extrapolated",
			stopsAway: 5 - 1,
		});
	});

	it("reports zero stops away without a time once the vehicle is past the alighting stop", () => {
		const stops = [
			stop(5, [vehicle("Y", 3, 60)]),
			stop(7, [vehicle("V", 6, 30)]),
		];
		expect(busBoards(null, stops, MADE_6411).progress("V", 5)).toEqual({
			etaAt: null,
			method: null,
			stopsAway: 0,
		});
	});

	it("returns null for a vehicle that is nowhere on the route", () => {
		expect(
			busBoards(null, stops6411, FETCHED_6411).progress("nope", 42)
		).toBeNull();
	});
});

describe("busBoards.rideMs", () => {
	it("measures the ride of a given vehicle between the two stops", () => {
		expect(
			busBoards(null, stops6411, FETCHED_6411).rideMs(VEHICLE_A, 39, 42)
		).toBe((544 - 208) * SECOND_MS);
	});

	it("uses the extrapolated arrival when the vehicle is not listed at the alighting stop", () => {
		const stops = [
			stop(2, [vehicle("V", 1, 60)]),
			stop(3, [vehicle("V", 1, 120)]),
			stop(5, [vehicle("U", 4, 40), vehicle("W", 3, 100)]),
		];
		expect(busBoards(null, stops, MADE_6411).rideMs("V", 2, 5)).toBe(
			(240 - 60) * SECOND_MS
		);
	});

	it("falls back to the route pace for a vehicle not listed at the boarding stop", () => {
		const stops = [
			stop(2, [vehicle("X", 1, 60)]),
			stop(4, [vehicle("Y", 2, 120)]),
		];
		expect(busBoards(null, stops, MADE_6411).rideMs("nope", 2, 4)).toBe(
			2 * 60 * SECOND_MS
		);
	});

	it("without a vehicle uses the first vehicles listed at the two stops", () => {
		expect(busBoards(null, stops6411, FETCHED_6411).rideMs(null, 39, 42)).toBe(
			(544 - 208) * SECOND_MS
		);
		const stops = [
			stop(2, [vehicle("X", 1, 100)]),
			stop(6, [vehicle("Y", 4, 250), vehicle("Z", 3, 400)]),
		];
		expect(busBoards(null, stops, MADE_6411).rideMs(null, 2, 6)).toBe(
			150 * SECOND_MS
		);
	});

	it("prefers the boarding stop's first vehicle when the alighting stop also lists it", () => {
		const stops = [
			stop(2, [vehicle("X", 1, 100)]),
			stop(6, [vehicle("Y", 4, 250), vehicle("X", 1, 520)]),
		];
		expect(busBoards(null, stops, MADE_6411).rideMs(null, 2, 6)).toBe(
			420 * SECOND_MS
		);
	});

	it("falls back to the route pace when the first-vehicle difference is negative", () => {
		// 한 정류장에 X 300초/1정류장, Y 100초/1정류장 → 중앙값 200초
		const stops = [
			stop(2, [vehicle("X", 1, 300)]),
			stop(6, [vehicle("Y", 5, 100)]),
		];
		expect(busBoards(null, stops, MADE_6411).rideMs(null, 2, 6)).toBe(
			4 * 200 * SECOND_MS
		);
	});

	it("falls back to the route pace when the boarding stop lists no vehicle (route origin)", () => {
		// 2026-11-12 6411 기점: 1~3번 정류장은 "출발대기"(vehId 0)뿐이다.
		const stops = [
			stop(1, []),
			stop(2, []),
			stop(4, [vehicle("A", 3, 50)]),
			stop(5, [vehicle("A", 3, 180)]),
			stop(10, [vehicle("B", 7, 210), vehicle("A", 3, 840)]),
		];
		// 정류장당 50, 90, 70, 120초 → 중앙값 80초
		expect(busBoards(null, stops, MADE_6411).rideMs(null, 1, 10)).toBe(
			9 * 80 * SECOND_MS
		);
	});

	it("falls back to the route pace when the alighting stop lists no vehicle", () => {
		const stops = [stop(7, [vehicle("C", 6, 60)]), stop(9, [])];
		expect(busBoards(null, stops, MADE_6411).rideMs(null, 7, 9)).toBe(
			2 * 60 * SECOND_MS
		);
	});

	it("returns null when no vehicle runs anywhere on the route", () => {
		const stops = [stop(1, []), stop(2, []), stop(3, [])];
		expect(busBoards(null, stops, MADE_6411).rideMs(null, 1, 3)).toBeNull();
	});

	it("ignores vehicles at or past their stop when measuring the pace", () => {
		const stops = [
			stop(2, [vehicle("D", 2, 0, { isArrived: true })]),
			stop(5, [vehicle("E", 3, 120)]),
		];
		expect(busBoards(null, stops, MADE_6411).rideMs(null, 1, 4)).toBe(
			3 * 60 * SECOND_MS
		);
	});
});

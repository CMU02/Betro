import { describe, expect, it } from "bun:test";
import arrivals6411 from "../__fixtures__/arr-all-6411.json";
import { commuteConfig } from "../config";
import type { BusLeg, Route, SubwayLeg } from "../plan";
import { estimateRoute } from "../session/estimate";
import { assembleBoards, legKey, type RawBoards } from "./assemble";
import {
	busBoards,
	parseRouteArrivals,
	type RouteStopArrival,
} from "./seoul-bus";
import {
	fillFromTimetable,
	type StationRow,
	stationBoard,
} from "./seoul-subway";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const T = Date.UTC(2026, 10, 9, 23, 10);
const config = commuteConfig({});

const busLeg: BusLeg = {
	alight: { name: "흑석동효사정앞", seq: 42, stop: "seoul-bus:119000030" },
	board: { name: "노량진역", seq: 39, stop: "seoul-bus:119000011" },
	line: "seoul-bus:100100290",
	lineName: "6411",
	mode: "bus",
};

/** 경기 마을버스(GBIS). 노선 ID가 서울 6411과 같아도 다른 노선이다. */
const gbisLeg: BusLeg = {
	alight: { name: "다", seq: 9, stop: "gbis:228000174" },
	board: { name: "라", seq: 2, stop: "gbis:228000160" },
	line: "gbis:100100290",
	lineName: "11",
	mode: "bus",
};

const subwayLeg: SubwayLeg = {
	alight: { name: "역삼", stop: "seoul-subway:1002000221" },
	board: { name: "강남", stop: "seoul-subway:1002000222" },
	direction: "down",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};

function stationRow(overrides: Partial<StationRow>): StationRow {
	return {
		arvlCd: "99",
		barvlSec: 120,
		direction: "down",
		ordkey: "01001성수0",
		sourceAt: T,
		trainNo: "2001",
		...overrides,
	};
}

const parsed = parseRouteArrivals(arrivals6411);
if (!parsed.ok) {
	throw new Error("fixture did not parse");
}
const busStops = parsed.stops;
const boardRows = [
	stationRow({ barvlSec: 120, ordkey: "01001성수0", trainNo: "2001" }),
	stationRow({ barvlSec: 0, ordkey: "02004성수0", trainNo: "2003" }),
	stationRow({ direction: "up", trainNo: "9999" }),
];
const alightRows = [
	stationRow({ barvlSec: 200, ordkey: "01002성수0", trainNo: "2001" }),
];
const arrivals = [
	{ at: T + 5 * MINUTE_MS, tripId: 1 },
	{ at: T + 9 * MINUTE_MS, tripId: 2 },
];

function raw(): RawBoards {
	return {
		bus: {
			"100100290": { fetchedAt: T, now: busStops, prev: null },
		},
		subway: {
			"1002000221": { fetchedAt: T, prev: null, rows: alightRows },
			"1002000222": { fetchedAt: T, prev: null, rows: boardRows },
		},
		timetable: {
			arrivals: { [legKey(subwayLeg)]: arrivals },
			rideMs: { [legKey(subwayLeg)]: 2 * MINUTE_MS },
		},
	};
}

describe("legKey", () => {
	it("tells legs apart by line, stops and direction", () => {
		const reversed: SubwayLeg = {
			...subwayLeg,
			alight: subwayLeg.board,
			board: subwayLeg.alight,
			direction: "up",
		};
		const otherDirection: SubwayLeg = { ...subwayLeg, direction: "up" };
		const keys = new Set([
			legKey(busLeg),
			legKey(subwayLeg),
			legKey(reversed),
			legKey(otherDirection),
		]);
		expect(keys.size).toBe(4);
		expect(legKey(subwayLeg)).toBe(legKey({ ...subwayLeg }));
	});
});

describe("assembleBoards", () => {
	it("gives a bus leg the bus stop boards", () => {
		const boards = assembleBoards(raw(), config);
		const expected = busBoards(null, busStops, T);
		expect(boards.board(busLeg, "board")).toEqual(expected.board(39));
		expect(boards.board(busLeg, "alight")).toEqual(expected.board(42));
		expect(boards.progress(busLeg, "103055116")).toEqual(
			expected.progress("103055116", 42)
		);
		expect(boards.rideMs(busLeg, "103055116")).toBe(
			expected.rideMs("103055116", 39, 42)
		);
		expect(boards.rideMs(busLeg, null)).toBe(expected.rideMs(null, 39, 42));
	});

	it("gives a subway leg the station board corrected and filled from the timetable", () => {
		const boards = assembleBoards(raw(), config);
		const expected = fillFromTimetable(
			stationBoard(null, boardRows, "down", 60, T),
			arrivals
		);
		const board = boards.board(subwayLeg, "board");
		expect(board).toEqual(expected);
		expect(board?.approaching.map((a) => [a.vehicleId, a.method])).toEqual([
			["2001", "official-corrected"],
			["2003", "timetable"],
		]);
		expect(boards.board(subwayLeg, "alight")).toEqual(
			stationBoard(null, alightRows, "down", 60, T)
		);
	});

	it("finds a subway train's progress on the alighting station's board", () => {
		const boards = assembleBoards(raw(), config);
		expect(boards.progress(subwayLeg, "2001")).toEqual({
			etaAt: T + (200 + 60) * SECOND_MS,
			method: "official-corrected",
			stopsAway: 2,
		});
		expect(boards.progress(subwayLeg, "2003")).toBeNull();
	});

	it("takes the subway ride time from the timetable", () => {
		const boards = assembleBoards(raw(), config);
		expect(boards.rideMs(subwayLeg, "2001")).toBe(2 * MINUTE_MS);
		expect(boards.rideMs(subwayLeg, null)).toBe(2 * MINUTE_MS);
	});

	it("uses no bias for a line without one", () => {
		const boards = assembleBoards(raw(), { ...config, subwayEtaBiasSec: {} });
		expect(boards.board(subwayLeg, "board")?.approaching[0]?.method).toBe(
			"official"
		);
	});

	it("returns null when the line or station has no data", () => {
		const boards = assembleBoards(
			{
				bus: {},
				subway: {},
				timetable: { arrivals: {}, rideMs: {} },
			},
			config
		);
		expect(boards.board(busLeg, "board")).toBeNull();
		expect(boards.board(subwayLeg, "board")).toBeNull();
		expect(boards.board(subwayLeg, "alight")).toBeNull();
		expect(boards.progress(busLeg, "103055116")).toBeNull();
		expect(boards.progress(subwayLeg, "2001")).toBeNull();
		expect(boards.rideMs(busLeg, null)).toBeNull();
		expect(boards.rideMs(subwayLeg, null)).toBeNull();
	});
});

describe("assembleBoards: scheduled bus headway", () => {
	/** 현지(서울 버스 출처 시간대) 12:00 = UTC 03:00. 운행 시간 안이다. */
	const NOON = Date.UTC(2026, 10, 21, 3, 0);
	/** 현지 03:00 = 전날 UTC 18:00. 첫차 전이다. */
	const BEFORE_FIRST = Date.UTC(2026, 10, 20, 18, 0);
	const schedule = { firstBusMinute: 270, headwayMin: 10, lastBusMinute: 1370 };

	it("gives a bus leg the headway from the route's schedule", () => {
		const boards = assembleBoards(
			{ ...raw(), busSchedules: { "seoul-bus:100100290": schedule } },
			config
		);
		expect(boards.scheduledHeadwayMs?.(busLeg, NOON)).toBe(10 * MINUTE_MS);
		expect(boards.scheduledHeadwayMs?.(busLeg, BEFORE_FIRST)).toBeNull();
	});

	it("returns null for a route without a schedule and for subway legs", () => {
		const boards = assembleBoards(
			{ ...raw(), busSchedules: { "seoul-bus:100100118": schedule } },
			config
		);
		expect(boards.scheduledHeadwayMs?.(busLeg, NOON)).toBeNull();
		expect(boards.scheduledHeadwayMs?.(subwayLeg, NOON)).toBeNull();
	});

	it("returns null when the raw boards carry no schedules", () => {
		const boards = assembleBoards(raw(), config);
		expect(boards.scheduledHeadwayMs?.(busLeg, NOON) ?? null).toBeNull();
	});

	it("estimates a bus leg with no board from the schedule", () => {
		const boards = assembleBoards(
			{
				bus: {},
				busSchedules: { "seoul-bus:100100290": schedule },
				subway: {},
				timetable: { arrivals: {}, rideMs: {} },
			},
			config
		);
		const route: Route = { legs: [busLeg], rank: 0, walkMinutes: [0, 0] };
		const [leg] = estimateRoute(
			route,
			boards,
			{ fixed: [], now: NOON, readyAt: NOON, skip: new Set() },
			config
		).legs;
		expect(leg?.boardEtaAt).toBe(NOON + 5 * MINUTE_MS);
		expect(leg?.method).toBe("headway");
		expect(leg?.positionState).toBe("none");
	});
});

describe("assembleBoards: GBIS and TAGO legs", () => {
	/** 현지 12:00 = UTC 03:00. 운행 시간 안이다. */
	const NOON = Date.UTC(2026, 10, 21, 3, 0);
	const tenMinutes = {
		firstBusMinute: 270,
		headwayMin: 10,
		lastBusMinute: 1370,
	};
	const thirtyMinutes = {
		firstBusMinute: 270,
		headwayMin: 30,
		lastBusMinute: 1370,
	};

	it("has no board, progress or ride time even when a Seoul route shares the id", () => {
		const boards = assembleBoards(raw(), config);
		expect(boards.board(gbisLeg, "board")).toBeNull();
		expect(boards.board(gbisLeg, "alight")).toBeNull();
		expect(boards.progress(gbisLeg, "103055116")).toBeNull();
		expect(boards.rideMs(gbisLeg, null)).toBeNull();
	});

	it("takes the headway keyed by the full line ref", () => {
		const boards = assembleBoards(
			{
				...raw(),
				busSchedules: {
					"gbis:100100290": tenMinutes,
					"seoul-bus:100100290": thirtyMinutes,
				},
			},
			config
		);
		expect(boards.scheduledHeadwayMs?.(gbisLeg, NOON)).toBe(10 * MINUTE_MS);
		expect(boards.scheduledHeadwayMs?.(busLeg, NOON)).toBe(30 * MINUTE_MS);
	});

	it("estimates the boarding from half the scheduled headway", () => {
		const boards = assembleBoards(
			{
				bus: {},
				busSchedules: { "gbis:100100290": tenMinutes },
				subway: {},
				timetable: { arrivals: {}, rideMs: {} },
			},
			config
		);
		const route: Route = { legs: [gbisLeg], rank: 0, walkMinutes: [0, 0] };
		const [leg] = estimateRoute(
			route,
			boards,
			{ fixed: [], now: NOON, readyAt: NOON, skip: new Set() },
			config
		).legs;
		expect(leg).toMatchObject({
			boardEtaAt: NOON + 5 * MINUTE_MS,
			etaState: "estimated",
			method: "headway",
			positionState: "none",
		});
	});
});

describe("estimate at a route's origin stop", () => {
	// 2026-11-12 운영: 6411 기점(정랑고개.양천벤처타운, 1번)은 "출발대기"(vehId 0)뿐이라
	// 승차 정류장에 차량이 없어 주행 시간을 몰랐고, 하차·목적지 시각이 모두 null이었다.
	const originLeg: BusLeg = {
		alight: { name: "구로역", seq: 10, stop: "seoul-bus:116000068" },
		board: {
			name: "정랑고개.양천벤처타운",
			seq: 1,
			stop: "seoul-bus:114000001",
		},
		line: "seoul-bus:100100290",
		lineName: "6411",
		mode: "bus",
	};
	const route: Route = { legs: [originLeg], rank: 0, walkMinutes: [5, 5] };
	const vehicleAt = (
		vehicleId: string,
		seqNow: number,
		etaSec: number
	): RouteStopArrival["vehicles"][number] => ({
		etaSec,
		isArrived: false,
		lastOfDay: false,
		plate: "",
		seqNow,
		vehicleId,
	});
	const stopAt = (
		seq: number,
		vehicles: RouteStopArrival["vehicles"]
	): RouteStopArrival => ({
		headwayMin: 12,
		madeAt: T,
		seq,
		stopId: `stop-${seq}`,
		vehicles,
	});
	const stops = [
		stopAt(1, []),
		stopAt(2, []),
		stopAt(4, [vehicleAt("A", 3, 60)]),
		stopAt(10, [vehicleAt("A", 3, 420)]),
	];

	it("still gives the alighting and destination times from the route pace", () => {
		const boards = assembleBoards(
			{
				bus: { "100100290": { fetchedAt: T, now: stops, prev: null } },
				subway: {},
				timetable: { arrivals: {}, rideMs: {} },
			},
			config
		);
		const readyAt = T + 5 * MINUTE_MS;
		const estimate = estimateRoute(
			route,
			boards,
			{ fixed: [], now: T, readyAt, skip: new Set() },
			config
		);
		const [leg] = estimate.legs;
		// 차량이 없으니 배차간격(12분)의 반을 기다린다.
		expect(leg?.boardEtaAt).toBe(readyAt + 6 * MINUTE_MS);
		// 정류장당 60초 × 9정류장
		expect(leg?.alightEtaAt).toBe(readyAt + 6 * MINUTE_MS + 9 * MINUTE_MS);
		expect(leg?.etaState).toBe("estimated");
		expect(estimate.destinationEtaAt).toBe(
			readyAt + 6 * MINUTE_MS + 9 * MINUTE_MS + 5 * MINUTE_MS
		);
	});
});

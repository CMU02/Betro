import { describe, expect, it } from "bun:test";
import arrivals6411 from "../__fixtures__/arr-all-6411.json";
import { commuteConfig } from "../config";
import type { BusLeg, SubwayLeg } from "../plan";
import { assembleBoards, legKey, type RawBoards } from "./assemble";
import { busBoards, parseRouteArrivals } from "./seoul-bus";
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

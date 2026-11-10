import { describe, expect, it } from "bun:test";
import gangnam from "../__fixtures__/subway-board-gangnam.json";
import { localToEpochMs } from "../calendar";
import { DEFAULT_TIMEZONE } from "../config";
import {
	fillFromTimetable,
	type StationRow,
	stationBoard,
} from "./seoul-subway";
import type { StopBoard } from "./types";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
/** 수집기와 같은 방향 변환(`arrivalDirection`): 내선은 up, 외선은 down. */
const DIRECTION: Record<string, "up" | "down"> = {
	내선: "up",
	상행: "up",
	외선: "down",
	하행: "down",
};

function localMs(text: string): number {
	const match = DATE_TIME.exec(text);
	if (!match) {
		throw new Error(`bad time ${text}`);
	}
	const minute = Number(match[2]) * 60 + Number(match[3]);
	return (
		localToEpochMs(match[1] as string, minute, DEFAULT_TIMEZONE) +
		Number(match[4]) * SECOND_MS
	);
}

function rowsOf(poll: (typeof gangnam.polls)[number]): StationRow[] {
	return poll.rows.map((row) => ({
		arvlCd: row.arvlCd,
		barvlSec: Number(row.barvlDt),
		direction: DIRECTION[row.updnLine] ?? "up",
		ordkey: row.ordkey,
		sourceAt: localMs(row.recptnDt),
		trainNo: row.btrainNo,
	}));
}

const [poll1, poll2] = gangnam.polls;
if (!(poll1 && poll2)) {
	throw new Error("fixture needs two polls");
}
const rows1 = rowsOf(poll1);
const rows2 = rowsOf(poll2);
const SOURCE_1 = localMs("2026-11-10 08:27:18");
const SOURCE_2 = localMs("2026-11-10 08:28:26");
const AT_0810 = localMs("2026-11-10 08:10:00");

function makeRow(overrides: Partial<StationRow> = {}): StationRow {
	return {
		arvlCd: "99",
		barvlSec: 240,
		direction: "up",
		ordkey: "01001성수0",
		sourceAt: AT_0810,
		trainNo: "2001",
		...overrides,
	};
}

describe("stationBoard", () => {
	it("keeps only trains in the asked direction, nearest first", () => {
		const board = stationBoard(null, rows1, "down", 0, poll1.fetchedAt);
		expect(board).toEqual({
			approaching: [
				{
					etaAt: SOURCE_1 + 90 * SECOND_MS,
					lastOfDay: false,
					method: "official",
					plate: null,
					stopsAway: 1,
					vehicleId: "2077",
				},
				{
					etaAt: SOURCE_1 + 260 * SECOND_MS,
					lastOfDay: false,
					method: "official",
					plate: null,
					stopsAway: 3,
					vehicleId: "3079",
				},
			],
			fetchedAt: poll1.fetchedAt,
			headwayMs: null,
			passed: [],
			sourceAt: SOURCE_1,
		});
	});

	it("reads stops away from the ordkey", () => {
		const board = stationBoard(
			null,
			[
				makeRow({ ordkey: "02006성수0", trainNo: "B" }),
				makeRow({ ordkey: "01001성수0", trainNo: "A" }),
			],
			"up",
			0,
			AT_0810
		);
		expect(board.approaching.map((a) => [a.vehicleId, a.stopsAway])).toEqual([
			["A", 1],
			["B", 6],
		]);
	});

	it("adds the line's bias to the official arrival and marks it corrected", () => {
		const corrected = stationBoard(null, [makeRow()], "up", 60, AT_0810);
		expect(corrected.approaching[0]?.etaAt).toBe(AT_0810 + 300_000);
		expect(corrected.approaching[0]?.method).toBe("official-corrected");
		const plain = stationBoard(null, [makeRow()], "up", 0, AT_0810);
		expect(plain.approaching[0]?.etaAt).toBe(AT_0810 + 240_000);
		expect(plain.approaching[0]?.method).toBe("official");
	});

	it("keeps the position of a train without an official arrival", () => {
		const board = stationBoard(
			null,
			[makeRow({ barvlSec: 0, ordkey: "02003성수0" })],
			"up",
			60,
			AT_0810
		);
		expect(board.approaching[0]).toEqual({
			etaAt: null,
			lastOfDay: false,
			method: null,
			plate: null,
			stopsAway: 3,
			vehicleId: "2001",
		});
	});

	it("lists a train that left the board since the last poll as passed", () => {
		const up = stationBoard(rows1, rows2, "up", 0, poll2.fetchedAt);
		expect(up.passed).toEqual([{ at: SOURCE_2, vehicleId: "6102" }]);
		expect(up.approaching.map((a) => a.vehicleId)).toEqual(["2104", "2106"]);
		expect(up.sourceAt).toBe(SOURCE_2);
		const down = stationBoard(rows1, rows2, "down", 0, poll2.fetchedAt);
		expect(down.passed).toEqual([]);
	});
});

describe("fillFromTimetable", () => {
	const twoWithoutEta = (): StopBoard =>
		stationBoard(
			null,
			[
				makeRow({ barvlSec: 0, ordkey: "01002성수0", trainNo: "A" }),
				makeRow({ barvlSec: 0, ordkey: "02005성수0", trainNo: "B" }),
			],
			"up",
			0,
			AT_0810
		);
	const timetable = [
		{ at: AT_0810 - MINUTE_MS, tripId: 0 },
		{ at: AT_0810 + 4 * MINUTE_MS, tripId: 1 },
		{ at: AT_0810 + 8 * MINUTE_MS, tripId: 2 },
		{ at: AT_0810 + 12 * MINUTE_MS, tripId: 3 },
	];

	it("gives trains without an arrival the next timetable arrivals in order", () => {
		const filled = fillFromTimetable(twoWithoutEta(), timetable);
		expect(
			filled.approaching.map((a) => [a.vehicleId, a.etaAt, a.method])
		).toEqual([
			["A", AT_0810 + 4 * MINUTE_MS, "timetable"],
			["B", AT_0810 + 8 * MINUTE_MS, "timetable"],
		]);
		expect(filled.headwayMs).toBe(4 * MINUTE_MS);
	});

	it("leaves the board alone when the timetable is empty", () => {
		const board = twoWithoutEta();
		expect(fillFromTimetable(board, [])).toEqual(board);
	});

	it("keeps official arrivals and does not reuse earlier timetable slots", () => {
		const board = stationBoard(
			null,
			[
				makeRow({ barvlSec: 300, ordkey: "01002성수0", trainNo: "A" }),
				makeRow({ barvlSec: 0, ordkey: "02005성수0", trainNo: "B" }),
			],
			"up",
			0,
			AT_0810
		);
		const filled = fillFromTimetable(board, timetable);
		expect(
			filled.approaching.map((a) => [a.vehicleId, a.etaAt, a.method])
		).toEqual([
			["A", AT_0810 + 5 * MINUTE_MS, "official"],
			["B", AT_0810 + 8 * MINUTE_MS, "timetable"],
		]);
	});
});

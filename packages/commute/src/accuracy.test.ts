import { describe, expect, it } from "bun:test";
import type { AccuracyRecord, SessionSummary } from "./accuracy";
import {
	dailyReport,
	inputRecordOf,
	recordsOf,
	suggestionRecordOf,
	summarize,
} from "./accuracy";
import { DEFAULT_TIMEZONE } from "./config";
import type { BusLeg, CommutePlan, Route, SubwayLeg } from "./plan";
import type { LegEstimate, RouteEstimate } from "./session/estimate";
import type { SessionState } from "./session/stage";
import type { StopBoard, TransitBoards } from "./sources/types";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 2026-11-10(화) 08:00 KST. */
const BASE = Date.UTC(2026, 10, 9, 23, 0);
const TUESDAY = 2;
const SESSION_ID = "c0ffee00-0000-4000-8000-000000000001";
const PLAN_ID = "0b9f3a52-6d1c-4f0e-9a51-1c7f7b0f4a10";

/** 08:mm:ss */
function at(minute: number, second = 0): number {
	return BASE + minute * MINUTE_MS + second * SECOND_MS;
}

const busLeg: BusLeg = {
	alight: { name: "고속터미널", seq: 40, stop: "seoul-bus:119000040" },
	board: { name: "노량진역", seq: 30, stop: "seoul-bus:119000030" },
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

const altBusLeg: BusLeg = {
	alight: { name: "흑석동", seq: 20, stop: "seoul-bus:119000120" },
	board: { name: "노량진수산시장", seq: 12, stop: "seoul-bus:119000112" },
	line: "seoul-bus:100100029",
	lineName: "150",
	mode: "bus",
};

const primary: Route = { legs: [busLeg], rank: 0, walkMinutes: [5, 3] };
const alt1: Route = { legs: [subwayLeg], rank: 1, walkMinutes: [4, 2] };
const alt2: Route = { legs: [altBusLeg], rank: 2, walkMinutes: [6, 4] };

const plan: CommutePlan = {
	enabled: true,
	planId: PLAN_ID,
	routes: [primary, alt1, alt2],
	schedule: {
		days: [1, 2, 3, 4, 5],
		includeHolidays: false,
		leadMinutes: 10,
		leaveMinute: 8 * 60 + 5,
		timezone: DEFAULT_TIMEZONE,
	},
};

function legEstimate(overrides: Partial<LegEstimate> = {}): LegEstimate {
	return {
		alightEtaAt: at(21, 24),
		boardEtaAt: at(11, 24),
		etaState: "live",
		method: "official",
		positionState: "live",
		stopsAway: 3,
		vehicleId: "V1",
		...overrides,
	};
}

function routeEstimate(
	rank: number,
	leg: LegEstimate,
	destinationEtaAt: number | null = at(24, 24)
): RouteEstimate {
	return { destinationEtaAt, legs: [leg], rank };
}

function sessionState(overrides: Partial<SessionState> = {}): SessionState {
	return {
		boardedBy: [null],
		endReason: null,
		estimates: [],
		fixed: [null],
		initialDestinationEtaAt: null,
		leaveAt: at(5),
		legIndex: 0,
		passed: null,
		planId: PLAN_ID,
		readyAt: at(10),
		seq: 0,
		sessionId: SESSION_ID,
		skip: [],
		stage: "walk",
		startedAt: at(-5),
		...overrides,
	};
}

function stopBoard(overrides: Partial<StopBoard> = {}): StopBoard {
	return {
		approaching: [],
		fetchedAt: at(10),
		headwayMs: 12 * MINUTE_MS,
		passed: [],
		sourceAt: at(10),
		...overrides,
	};
}

/** 정류장 ID → 도착판. 승차·하차를 가리지 않고 정류장으로 찾는다. */
function boardsOf(byStop: Record<string, StopBoard>): TransitBoards {
	return {
		board: (leg, side) => byStop[leg[side].stop] ?? null,
		progress: () => null,
		rideMs: () => null,
	};
}

describe("recordsOf", () => {
	it("records the primary route's first leg prediction once per tick", () => {
		const now = at(1, 30);
		const next = sessionState({
			estimates: [routeEstimate(0, legEstimate())],
			fixed: ["V1"],
		});
		const boards = boardsOf({
			[busLeg.board.stop]: stopBoard({ sourceAt: at(1, 20) }),
		});
		const records = recordsOf(
			sessionState(),
			next,
			boards,
			plan,
			now,
			DEFAULT_TIMEZONE
		);
		expect(records).toEqual([
			{
				at: now,
				direction: null,
				etaAt: at(11, 24),
				etaState: "live",
				kind: "prediction",
				legIndex: 0,
				line: busLeg.line,
				localMinute: 8 * 60 + 11,
				method: "official",
				planId: PLAN_ID,
				positionState: "live",
				rank: 0,
				sessionId: SESSION_ID,
				sourceAt: at(1, 20),
				stop: busLeg.board.stop,
				stopsAway: 3,
				vehicleId: "V1",
				weekday: TUESDAY,
			},
		]);
	});

	it("adds the first leg of every alternative: two alternatives make three predictions", () => {
		const next = sessionState({
			estimates: [
				routeEstimate(0, legEstimate()),
				routeEstimate(
					1,
					legEstimate({ boardEtaAt: at(9), vehicleId: "2077" }),
					at(20)
				),
				routeEstimate(
					2,
					legEstimate({
						boardEtaAt: at(12),
						etaState: "estimated",
						method: "headway",
						vehicleId: "W9",
					}),
					at(30)
				),
			],
		});
		const boards = boardsOf({
			[busLeg.board.stop]: stopBoard(),
			[subwayLeg.board.stop]: stopBoard(),
			[altBusLeg.board.stop]: stopBoard(),
		});
		const records = recordsOf(
			sessionState(),
			next,
			boards,
			plan,
			at(1),
			DEFAULT_TIMEZONE
		);
		const predictions = records.filter(
			(record) => record.kind === "prediction"
		);
		expect(predictions).toHaveLength(3);
		expect(
			predictions.map((record) => [
				record.rank,
				record.stop,
				record.direction,
				record.vehicleId,
				record.method,
			])
		).toEqual([
			[0, busLeg.board.stop, null, "V1", "official"],
			[1, subwayLeg.board.stop, "down", "2077", "official"],
			[2, altBusLeg.board.stop, null, "W9", "headway"],
		]);
	});

	it("skips a leg with no vehicle or no time, and predicts nothing once riding", () => {
		const boards = boardsOf({ [busLeg.board.stop]: stopBoard() });
		const noVehicle = sessionState({
			estimates: [routeEstimate(0, legEstimate({ vehicleId: null }))],
		});
		expect(
			recordsOf(null, noVehicle, boards, plan, at(1), DEFAULT_TIMEZONE)
		).toEqual([]);
		const riding = sessionState({
			estimates: [routeEstimate(0, legEstimate({ boardEtaAt: null }))],
			fixed: ["V1"],
			stage: "ride",
		});
		expect(
			recordsOf(null, riding, boards, plan, at(12), DEFAULT_TIMEZONE)
		).toEqual([]);
	});

	it("records an arrival between the previous and the current board when the vehicle passes", () => {
		const prev = sessionState({
			estimates: [routeEstimate(0, legEstimate())],
			fixed: ["V1"],
		});
		const next = sessionState({
			estimates: [
				routeEstimate(0, legEstimate({ boardEtaAt: at(23), vehicleId: "V2" })),
			],
		});
		const passedBoard = stopBoard({
			passed: [{ at: at(11, 40), vehicleId: "V1" }],
			prevSourceAt: at(10, 40),
			sourceAt: at(11, 40),
		});
		const boards = boardsOf({ [busLeg.board.stop]: passedBoard });
		const records = recordsOf(
			prev,
			next,
			boards,
			plan,
			at(12),
			DEFAULT_TIMEZONE
		);
		expect(records.filter((record) => record.kind === "arrival")).toEqual([
			{
				high: at(11, 40),
				kind: "arrival",
				line: busLeg.line,
				low: at(10, 40),
				sessionId: SESSION_ID,
				stop: busLeg.board.stop,
				vehicleId: "V1",
			},
		]);
		// 다음 tick에도 같은 도착판이 남아 있지만, 직전 상태는 이미 V2를 보고 있어 다시 남기지 않는다.
		const again = recordsOf(
			next,
			next,
			boards,
			plan,
			at(12, 30),
			DEFAULT_TIMEZONE
		);
		expect(again.filter((record) => record.kind === "arrival")).toEqual([]);
	});

	it("records the ridden vehicle's arrival at the alighting stop", () => {
		const prev = sessionState({
			estimates: [routeEstimate(0, legEstimate({ boardEtaAt: null }))],
			fixed: ["V1"],
			stage: "ride",
		});
		const next = sessionState({
			estimates: [
				routeEstimate(
					0,
					legEstimate({ alightEtaAt: null, boardEtaAt: null }),
					null
				),
			],
			fixed: ["V1"],
			stage: "arrived",
		});
		const boards = boardsOf({
			[busLeg.alight.stop]: stopBoard({
				passed: [{ at: at(22), vehicleId: "V1" }],
				prevSourceAt: at(21),
				sourceAt: at(22),
			}),
		});
		const records = recordsOf(
			prev,
			next,
			boards,
			plan,
			at(22, 10),
			DEFAULT_TIMEZONE
		);
		expect(records).toEqual([
			{
				high: at(22),
				kind: "arrival",
				line: busLeg.line,
				low: at(21),
				sessionId: SESSION_ID,
				stop: busLeg.alight.stop,
				vehicleId: "V1",
			},
		]);
	});
});

describe("inputRecordOf and suggestionRecordOf", () => {
	it("keeps the vehicle the input was about", () => {
		const prev = sessionState({ fixed: ["V1"] });
		const boarded = sessionState({ fixed: ["V1"], stage: "ride" });
		expect(
			inputRecordOf(prev, boarded, { kind: "boarded" }, at(11, 30))
		).toEqual({
			at: at(11, 30),
			input: "boarded",
			kind: "input",
			sessionId: SESSION_ID,
			vehicleId: "V1",
		});
		const skipped = sessionState({ fixed: [null], skip: ["V1"] });
		expect(inputRecordOf(prev, skipped, { kind: "next" }, at(9))).toMatchObject(
			{ input: "next", vehicleId: "V1" }
		);
	});

	it("names both vehicles, their alighting stops and the time after alighting", () => {
		const state = sessionState({
			estimates: [
				routeEstimate(0, legEstimate(), at(24, 24)),
				routeEstimate(
					1,
					legEstimate({
						alightEtaAt: at(15),
						boardEtaAt: at(7),
						vehicleId: "2077",
					}),
					at(17)
				),
			],
			fixed: ["V1"],
		});
		const found = suggestionRecordOf(state, plan, 1, at(1));
		expect(found?.record).toEqual({
			alternative: {
				afterAlightMs: 2 * MINUTE_MS,
				alightStop: subwayLeg.alight.stop,
				destinationEtaAt: at(17),
				rank: 1,
				vehicleId: "2077",
			},
			at: at(1),
			kind: "suggestion",
			primary: {
				afterAlightMs: 3 * MINUTE_MS,
				alightStop: busLeg.alight.stop,
				destinationEtaAt: at(24, 24),
				vehicleId: "V1",
			},
			sessionId: SESSION_ID,
		});
		expect(found?.follow).toEqual([
			{ leg: busLeg, vehicleId: "V1" },
			{ leg: subwayLeg, vehicleId: "2077" },
		]);
		const noVehicle = sessionState({
			estimates: [
				routeEstimate(0, legEstimate({ vehicleId: null })),
				routeEstimate(1, legEstimate({ vehicleId: "2077" }), at(17)),
			],
		});
		expect(suggestionRecordOf(noVehicle, plan, 1, at(1))).toBeNull();
	});
});

function prediction(
	overrides: Partial<Extract<AccuracyRecord, { kind: "prediction" }>>
): AccuracyRecord {
	return {
		at: at(10, 10),
		direction: null,
		etaAt: at(14, 20),
		etaState: "live",
		kind: "prediction",
		legIndex: 0,
		line: busLeg.line,
		localMinute: 8 * 60 + 14,
		method: "official",
		planId: PLAN_ID,
		positionState: "live",
		rank: 0,
		sessionId: SESSION_ID,
		sourceAt: at(10),
		stop: busLeg.board.stop,
		stopsAway: 5,
		vehicleId: "V1",
		weekday: TUESDAY,
		...overrides,
	};
}

function arrival(
	vehicleId: string,
	stop: string,
	low: number,
	high: number
): AccuracyRecord {
	return {
		high,
		kind: "arrival",
		line: busLeg.line,
		low,
		sessionId: SESSION_ID,
		stop: stop as BusLeg["board"]["stop"],
		vehicleId,
	};
}

describe("summarize", () => {
	it("scores the prediction made closest to five minutes before the arrival", () => {
		const records: AccuracyRecord[] = [
			// 6분 전: ±60초 밖이라 후보가 아니다.
			prediction({ at: at(9), etaAt: at(15, 30) }),
			prediction({ at: at(10, 10), etaAt: at(14, 20) }),
			prediction({ at: at(10, 40), etaAt: at(14, 50) }),
			arrival("V1", busLeg.board.stop, at(14, 50), at(15, 10)),
		];
		expect(summarize(records).predictions).toEqual([
			{
				errorMs: -40_000,
				halfWidthMs: 10_000,
				leadMs: 290_000,
				line: busLeg.line,
				method: "official",
				stop: busLeg.board.stop,
			},
		]);
	});

	it("leaves out an arrival with no prediction within a minute of five minutes before", () => {
		const records: AccuracyRecord[] = [
			prediction({ at: at(13), etaAt: at(15) }),
			prediction({ at: at(8, 50), etaAt: at(15) }),
			prediction({ at: at(10), etaAt: at(15), vehicleId: "V2" }),
			arrival("V1", busLeg.board.stop, at(14, 50), at(15, 10)),
		];
		expect(summarize(records).predictions).toEqual([]);
	});

	it("measures the start delay from shownAt, then tokenAt, else null", () => {
		const start = (
			shownAt: number | null,
			tokenAt: number | null
		): AccuracyRecord => ({
			dueAt: at(-5),
			kind: "start",
			sentAt: at(-5, 1),
			sessionId: SESSION_ID,
			shownAt,
			tokenAt,
		});
		expect(summarize([start(at(-5, 20), at(-5, 4))]).startDelayMs).toBe(20_000);
		expect(summarize([start(null, at(-5, 4))]).startDelayMs).toBe(4000);
		expect(summarize([start(null, null)]).startDelayMs).toBeNull();
		expect(summarize([]).startDelayMs).toBeNull();
	});

	it("takes the largest gap between ok sends", () => {
		const send = (time: number, outcome: string): AccuracyRecord => ({
			at: time,
			kind: "send",
			outcome,
			reason: "change",
			seq: 1,
			sessionId: SESSION_ID,
		});
		const gaps = summarize([
			send(at(0), "ok"),
			send(at(0, 30), "ok"),
			send(at(1, 40), "retry"),
			send(at(2, 20), "ok"),
		]);
		expect(gaps.maxSendGapMs).toBe(110_000);
		expect(summarize([send(at(0), "ok")]).maxSendGapMs).toBe(0);
	});

	it("reads the plan and the end reason from the end record", () => {
		const ended = summarize([
			{
				at: at(30),
				kind: "end",
				planId: PLAN_ID,
				reason: "arrived",
				sessionId: SESSION_ID,
			},
		]);
		expect(ended.sessionId).toBe(SESSION_ID);
		expect(ended.planId).toBe(PLAN_ID);
		expect(ended.endReason).toBe("arrived");
	});

	it("judges a suggestion by both vehicles' observed alighting plus the time after it", () => {
		const suggestion: AccuracyRecord = {
			alternative: {
				afterAlightMs: 3 * MINUTE_MS,
				alightStop: altBusLeg.alight.stop,
				destinationEtaAt: at(29),
				rank: 2,
				vehicleId: "W9",
			},
			at: at(1),
			kind: "suggestion",
			primary: {
				afterAlightMs: 3 * MINUTE_MS,
				alightStop: busLeg.alight.stop,
				destinationEtaAt: at(33),
				vehicleId: "V1",
			},
			sessionId: SESSION_ID,
		};
		const altArrival = arrival(
			"W9",
			altBusLeg.alight.stop,
			at(25, 50),
			at(26, 10)
		);
		const primaryArrival = arrival(
			"V1",
			busLeg.alight.stop,
			at(29, 50),
			at(30, 10)
		);
		expect(
			summarize([suggestion, altArrival, primaryArrival]).suggestions
		).toEqual([{ gainMs: 240_000, verdict: "faster" }]);
		expect(summarize([suggestion, altArrival]).suggestions).toEqual([
			{ gainMs: null, verdict: "unknown" },
		]);
		const lateAlt = arrival("W9", altBusLeg.alight.stop, at(31), at(31));
		expect(
			summarize([suggestion, lateAlt, primaryArrival]).suggestions
		).toEqual([{ gainMs: -60_000, verdict: "slower" }]);
	});
});

function summary(overrides: Partial<SessionSummary>): SessionSummary {
	return {
		endReason: "arrived",
		maxSendGapMs: 60_000,
		planId: PLAN_ID,
		predictions: [],
		sessionId: SESSION_ID,
		startDelayMs: 10_000,
		suggestions: [],
		...overrides,
	};
}

function scored(errorMs: number): SessionSummary["predictions"][number] {
	return {
		errorMs,
		halfWidthMs: 15_000,
		leadMs: 300_000,
		line: busLeg.line,
		method: "official",
		stop: busLeg.board.stop,
	};
}

describe("dailyReport", () => {
	it("counts starts, accuracy bands, end reasons and suggestion verdicts", () => {
		const report = dailyReport("2026-11-10", [
			summary({
				predictions: [scored(30_000)],
				startDelayMs: 10_000,
				suggestions: [{ gainMs: 240_000, verdict: "faster" }],
			}),
			summary({
				maxSendGapMs: 95_000,
				predictions: [scored(90_000)],
				startDelayMs: -20_000,
				suggestions: [{ gainMs: null, verdict: "unknown" }],
			}),
			summary({
				endReason: "user",
				predictions: [scored(150_000)],
				startDelayMs: 80_000,
			}),
		]);
		expect(report).toEqual({
			accuracy: {
				"seoul-bus|official": {
					medianErrorMs: 90_000,
					n: 3,
					within60: 1,
					within120: 2,
				},
			},
			date: "2026-11-10",
			endReasons: { arrived: 2, user: 1 },
			maxSendGapMs: 95_000,
			sessions: 3,
			starts: { late: 1, onTime: 2, unknown: 0 },
			suggestions: { faster: 1, slower: 0, unknown: 1 },
		});
	});

	it("does not throw with no summaries", () => {
		expect(dailyReport("2026-11-10", [])).toEqual({
			accuracy: {},
			date: "2026-11-10",
			endReasons: {},
			maxSendGapMs: 0,
			sessions: 0,
			starts: { late: 0, onTime: 0, unknown: 0 },
			suggestions: { faster: 0, slower: 0, unknown: 0 },
		});
	});

	it("counts an unknown start delay as unknown", () => {
		const report = dailyReport("2026-11-10", [summary({ startDelayMs: null })]);
		expect(report.starts).toEqual({ late: 0, onTime: 0, unknown: 1 });
	});
});

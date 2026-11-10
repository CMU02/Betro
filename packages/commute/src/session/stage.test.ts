import { describe, expect, it } from "bun:test";
import { commuteConfig } from "../config";
import type { BusLeg, CommutePlan, Leg, Route, SubwayLeg } from "../plan";
import type {
	Approaching,
	Progress,
	StopBoard,
	TransitBoards,
} from "../sources/types";
import type { SessionInput, SessionState } from "./stage";
import { advance, startSession } from "./stage";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 08:00(현지)로 읽는 기준 시각. 계산은 시간대와 무관하게 epoch 차이만 본다. */
const BASE = Date.UTC(2026, 10, 9, 23, 0);
const config = commuteConfig({});

/** 08:mm:ss */
function at(minute: number, second = 0): number {
	return BASE + minute * MINUTE_MS + second * SECOND_MS;
}

function vehicle(
	vehicleId: string,
	etaAt: number | null,
	overrides: Partial<Approaching> = {}
): Approaching {
	return {
		etaAt,
		lastOfDay: false,
		method: etaAt === null ? null : "official",
		plate: null,
		stopsAway: 3,
		vehicleId,
		...overrides,
	};
}

function stopBoard(
	approaching: Approaching[],
	overrides: Partial<StopBoard> = {}
): StopBoard {
	return {
		approaching,
		fetchedAt: at(0),
		headwayMs: 8 * MINUTE_MS,
		passed: [],
		sourceAt: at(0),
		...overrides,
	};
}

interface LegView {
	alight?: StopBoard | null;
	board?: StopBoard | null;
	progress?: Record<string, Progress>;
	rideMs?: number | null;
}

/**
 * 구간 객체를 키로 손으로 만든 도착판. 도착판의 sourceAt은 묵지 않게 `now`로 맞춘다.
 */
function fakeBoards(now: number, entries: [Leg, LegView][]): TransitBoards {
	const byLeg = new Map(entries);
	const fresh = (board: StopBoard | null | undefined): StopBoard | null =>
		board ? { ...board, fetchedAt: now, sourceAt: now } : null;
	return {
		board: (leg, side) =>
			fresh(side === "board" ? byLeg.get(leg)?.board : byLeg.get(leg)?.alight),
		progress: (leg, vehicleId) => byLeg.get(leg)?.progress?.[vehicleId] ?? null,
		rideMs: (leg) => byLeg.get(leg)?.rideMs ?? null,
	};
}

const busLeg: BusLeg = {
	alight: { name: "흑석동효사정앞", seq: 42, stop: "seoul-bus:119000030" },
	board: { name: "노량진역", seq: 39, stop: "seoul-bus:119000011" },
	line: "seoul-bus:100100290",
	lineName: "6411",
	mode: "bus",
};

const altBusLeg: BusLeg = {
	alight: { name: "흑석동", seq: 20, stop: "seoul-bus:119000040" },
	board: { name: "노량진수산시장", seq: 12, stop: "seoul-bus:119000041" },
	line: "seoul-bus:100100150",
	lineName: "360",
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

const busRoute: Route = { legs: [busLeg], rank: 0, walkMinutes: [5, 3] };
const altRoute: Route = { legs: [altBusLeg], rank: 1, walkMinutes: [2, 4] };
const transferRoute: Route = {
	legs: [busLeg, subwayLeg],
	rank: 0,
	walkMinutes: [5, 4, 2],
};

function planOf(routes: Route[]): CommutePlan {
	return {
		enabled: true,
		planId: "0b9f3a52-6d1c-4f0e-9a51-1c7f7b0f4a10",
		routes,
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute: 8 * 60 + 10,
			timezone: "Asia/Seoul",
		},
	};
}

const busPlan = planOf([busRoute, altRoute]);
const transferPlan = planOf([transferRoute]);

/** 나가는 시각 08:10, 시작 08:00. */
function started(plan: CommutePlan = busPlan): SessionState {
	return startSession(plan, { leaveAt: at(10), startAt: at(0) }, "session-1");
}

/** 6411 승차 정류장: B 08:17, C 08:22, D 08:30. 주행 14분. */
function busView(overrides: LegView = {}): LegView {
	return {
		board: stopBoard([
			vehicle("B", at(17)),
			vehicle("C", at(22)),
			vehicle("D", at(30)),
		]),
		rideMs: 14 * MINUTE_MS,
		...overrides,
	};
}

/** 360 승차 정류장: Y 08:16. 주행 10분. */
const altView: LegView = {
	board: stopBoard([vehicle("Y", at(16))]),
	rideMs: 10 * MINUTE_MS,
};

function busBoardsAt(now: number, overrides: LegView = {}): TransitBoards {
	return fakeBoards(now, [
		[busLeg, busView(overrides)],
		[altBusLeg, altView],
	]);
}

function step(
	state: SessionState,
	now: number,
	boards: TransitBoards,
	input?: SessionInput,
	plan: CommutePlan = busPlan
): SessionState {
	return advance(state, plan, boards, now, config, input);
}

/** 08:00에 시작해 B(08:17)를 잡은 상태. */
function caughtB(): SessionState {
	return step(started(), at(0), busBoardsAt(at(0)));
}

/** B를 "탔어요"로 확정한 상태(08:17). */
function ridingB(): SessionState {
	const boards = busBoardsAt(at(17), {
		board: stopBoard([
			vehicle("B", at(17), { stopsAway: 0 }),
			vehicle("C", at(22)),
		]),
	});
	return step(caughtB(), at(17), boards, { kind: "boarded" });
}

describe("startSession", () => {
	it("구간마다 빈 칸을 두고 walk로 시작한다", () => {
		const state = started(transferPlan);
		expect(state).toEqual({
			boardedBy: [null, null],
			endReason: null,
			estimates: [],
			fixed: [null, null],
			initialDestinationEtaAt: null,
			leaveAt: at(10),
			legIndex: 0,
			passed: null,
			planId: transferPlan.planId,
			readyAt: null,
			seq: 0,
			sessionId: "session-1",
			skip: [],
			stage: "walk",
			startedAt: at(0),
		});
	});
});

describe("advance: 탑승 전", () => {
	it("시작 직후(나가기 10분 전)는 walk이고 나가는 시각 + 도보 뒤 첫 차량을 잡는다", () => {
		const state = caughtB();
		expect(state.stage).toBe("walk");
		expect(state.readyAt).toBe(at(15));
		expect(state.fixed).toEqual(["B"]);
		expect(state.estimates[0]?.legs[0]?.vehicleId).toBe("B");
		// 08:17 승차 + 14분 주행 + 3분 도보
		expect(state.estimates[0]?.destinationEtaAt).toBe(at(34));
	});

	it("늦게 나간 경우(나가는 시각 5분 뒤) readyAt이 now + 도보가 되어 더 늦은 차량을 고른다", () => {
		const state = step(started(), at(15), busBoardsAt(at(15)));
		expect(state.readyAt).toBe(at(20));
		expect(state.fixed).toEqual(["C"]);
		expect(state.stage).toBe("walk");
	});

	it("readyAt 전에는 walk, 지나면 wait", () => {
		const before = step(caughtB(), at(14, 59), busBoardsAt(at(14, 59)));
		expect(before.stage).toBe("walk");
		const after = step(caughtB(), at(15), busBoardsAt(at(15)));
		expect(after.stage).toBe("wait");
		expect(after.fixed).toEqual(["B"]);
	});

	it("잡은 차량이 readyAt 전에 지나가면 다음 차량으로 바꾸고 지나간 노선을 한 번 알린다", () => {
		const boards = busBoardsAt(at(14), {
			board: stopBoard([vehicle("C", at(22)), vehicle("D", at(30))], {
				passed: [{ at: at(14), vehicleId: "B" }],
			}),
		});
		const missed = step(caughtB(), at(14), boards);
		expect(missed.fixed).toEqual(["C"]);
		expect(missed.passed).toEqual({ lineName: "6411" });
		expect(missed.skip).toContain("B");
		expect(missed.stage).toBe("walk");
		expect(missed.boardedBy).toEqual([null]);

		const next = step(missed, at(14, 30), boards);
		expect(next.passed).toBeNull();
		expect(next.fixed).toEqual(["C"]);
		expect(next.skip).toContain("B");
	});

	it("잡은 차량이 readyAt 뒤에 지나가면 탄 것으로 본다", () => {
		const boards = busBoardsAt(at(17, 30), {
			board: stopBoard([vehicle("C", at(22))], {
				passed: [{ at: at(17), vehicleId: "B" }],
			}),
			progress: { B: { etaAt: at(31), method: "official", stopsAway: 3 } },
		});
		const state = step(caughtB(), at(17, 30), boards);
		expect(state.stage).toBe("ride");
		expect(state.boardedBy).toEqual(["time"]);
		expect(state.fixed).toEqual(["B"]);
		expect(state.passed).toBeNull();
	});
});

describe("advance: 다음 차 탈게요", () => {
	it("잡은 차량을 건너뛰고 다음 차량을 잡는다. 두 번 누르면 그다음 차량", () => {
		const boards = busBoardsAt(at(5));
		const once = step(caughtB(), at(5), boards, { kind: "next" });
		expect(once.fixed).toEqual(["C"]);
		expect(once.skip).toEqual(["B"]);
		expect(once.estimates[0]?.legs[0]?.vehicleId).toBe("C");

		const twice = step(once, at(5), boards, { kind: "next" });
		expect(twice.fixed).toEqual(["D"]);
		expect(twice.skip).toEqual(["B", "C"]);
	});

	it("탑승 뒤에는 상태를 바꾸지 않는다", () => {
		const riding = ridingB();
		const boards = busBoardsAt(at(17), {
			board: stopBoard([
				vehicle("B", at(17), { stopsAway: 0 }),
				vehicle("C", at(22)),
			]),
		});
		expect(step(riding, at(17), boards, { kind: "next" })).toEqual(riding);
	});
});

describe("advance: 탔어요", () => {
	it("3분 안에 승차 정류장을 지난 차량 중 가장 최근 것으로 탄다", () => {
		const boards = busBoardsAt(at(18), {
			board: stopBoard([vehicle("C", at(22))], {
				passed: [
					{ at: at(14), vehicleId: "OLD" },
					{ at: at(16), vehicleId: "B" },
				],
			}),
		});
		const state = step(caughtB(), at(18), boards, { kind: "boarded" });
		expect(state.stage).toBe("ride");
		expect(state.boardedBy).toEqual(["user"]);
		expect(state.fixed).toEqual(["B"]);
	});

	it("지난 차량이 없으면 stopsAway가 0인 차량으로 탄다", () => {
		const boards = busBoardsAt(at(16), {
			board: stopBoard(
				[vehicle("X", at(16), { stopsAway: 0 }), vehicle("B", at(17))],
				{ passed: [{ at: at(12), vehicleId: "OLD" }] }
			),
		});
		const state = step(caughtB(), at(16), boards, { kind: "boarded" });
		expect(state.stage).toBe("ride");
		expect(state.boardedBy).toEqual(["user"]);
		expect(state.fixed).toEqual(["X"]);
	});

	it("둘 다 없으면 잡아 둔 차량으로 탄다", () => {
		const state = step(caughtB(), at(16), busBoardsAt(at(16)), {
			kind: "boarded",
		});
		expect(state.stage).toBe("ride");
		expect(state.fixed).toEqual(["B"]);
	});

	it("두 번 눌러도 두 번째는 상태가 같다", () => {
		const boards = busBoardsAt(at(17), {
			board: stopBoard([
				vehicle("B", at(17), { stopsAway: 0 }),
				vehicle("C", at(22)),
			]),
		});
		const once = step(caughtB(), at(17), boards, { kind: "boarded" });
		expect(once.stage).toBe("ride");
		expect(once.fixed).toEqual(["B"]);
		const twice = step(once, at(17), boards, { kind: "boarded" });
		expect(twice).toEqual(once);
	});

	it("탑승 뒤 estimates에는 기본 경로만 있다", () => {
		expect(caughtB().estimates.map((estimate) => estimate.rank)).toEqual([
			0, 1,
		]);
		expect(ridingB().estimates.map((estimate) => estimate.rank)).toEqual([0]);
	});
});

describe("advance: 대안 경로", () => {
	it("대안은 잡은 차량과 skip 없이 자기 첫 도보로 고른다", () => {
		const state = step(caughtB(), at(5), busBoardsAt(at(5)), { kind: "next" });
		const alternative = state.estimates.find((estimate) => estimate.rank === 1);
		// 08:10 + 2분 도보 → 08:12 뒤 첫 차량 Y(08:16), 10분 주행, 4분 도보
		expect(alternative?.legs[0]?.vehicleId).toBe("Y");
		expect(alternative?.destinationEtaAt).toBe(at(30));
		expect(state.fixed).toEqual(["C"]);
	});
});

describe("advance: 하차와 환승", () => {
	const subwayView: LegView = {
		board: stopBoard([vehicle("T1", at(29)), vehicle("T2", at(32))]),
		rideMs: 2 * MINUTE_MS,
	};

	function transferBoards(now: number, bus: LegView = {}): TransitBoards {
		return fakeBoards(now, [
			[busLeg, busView({ rideMs: 10 * MINUTE_MS, ...bus })],
			[subwayLeg, subwayView],
		]);
	}

	function ridingTransfer(): SessionState {
		const caught = step(
			started(transferPlan),
			at(0),
			transferBoards(at(0)),
			undefined,
			transferPlan
		);
		const boards = transferBoards(at(17), {
			board: stopBoard([vehicle("B", at(17), { stopsAway: 0 })]),
		});
		return step(caught, at(17), boards, { kind: "boarded" }, transferPlan);
	}

	it("첫 구간 하차 정류장에 닿으면 다음 구간 walk, 환승 도보가 지나면 wait", () => {
		const riding = ridingTransfer();
		expect(riding.stage).toBe("ride");
		const boards = transferBoards(at(27), {
			board: stopBoard([vehicle("C", at(30))]),
			progress: { B: { etaAt: null, method: "official", stopsAway: 0 } },
		});
		const walking = step(riding, at(27), boards, undefined, transferPlan);
		expect(walking.legIndex).toBe(1);
		expect(walking.stage).toBe("walk");
		expect(walking.readyAt).toBe(at(31));
		expect(walking.fixed).toEqual(["B", "T2"]);
		expect(walking.estimates[0]?.legs[1]?.vehicleId).toBe("T2");
		// 08:32 승차 + 2분 + 2분 도보
		expect(walking.estimates[0]?.destinationEtaAt).toBe(at(36));

		const waiting = step(walking, at(31), boards, undefined, transferPlan);
		expect(waiting.legIndex).toBe(1);
		expect(waiting.stage).toBe("wait");
		expect(waiting.fixed).toEqual(["B", "T2"]);
	});

	it("하차 정류장의 passed에 탄 차량이 있으면 다음 구간으로 넘어간다", () => {
		const boards = transferBoards(at(28), {
			alight: stopBoard([], { passed: [{ at: at(27), vehicleId: "B" }] }),
			board: stopBoard([vehicle("C", at(30))]),
		});
		const state = step(
			ridingTransfer(),
			at(28),
			boards,
			undefined,
			transferPlan
		);
		expect(state.legIndex).toBe(1);
		expect(state.readyAt).toBe(at(31));
	});

	it("하차 예정 시각이 지나면 다음 구간으로 넘어간다", () => {
		const boards = transferBoards(at(27), {
			board: stopBoard([vehicle("C", at(30))]),
			progress: { B: { etaAt: at(26), method: "official", stopsAway: 1 } },
		});
		const state = step(
			ridingTransfer(),
			at(27),
			boards,
			undefined,
			transferPlan
		);
		expect(state.legIndex).toBe(1);
		expect(state.stage).toBe("walk");
		expect(state.readyAt).toBe(at(30));
	});

	it("하차 예정 전이면 ride로 남는다", () => {
		const boards = transferBoards(at(25), {
			board: stopBoard([vehicle("C", at(30))]),
			progress: { B: { etaAt: at(27), method: "official", stopsAway: 2 } },
		});
		const state = step(
			ridingTransfer(),
			at(25),
			boards,
			undefined,
			transferPlan
		);
		expect(state.legIndex).toBe(0);
		expect(state.stage).toBe("ride");
	});

	it("마지막 구간에서 내리면 arrived, 마지막 도보 + 10분 뒤 ended", () => {
		const boards = busBoardsAt(at(31), {
			board: stopBoard([vehicle("C", at(32))]),
			progress: { B: { etaAt: null, method: "official", stopsAway: 0 } },
		});
		const arrived = step(ridingB(), at(31), boards);
		expect(arrived.stage).toBe("arrived");
		expect(arrived.legIndex).toBe(0);
		expect(arrived.readyAt).toBe(at(34));
		expect(arrived.endReason).toBeNull();

		const grace = step(arrived, at(43, 59), boards);
		expect(grace.stage).toBe("arrived");
		const ended = step(arrived, at(44), boards);
		expect(ended.stage).toBe("ended");
		expect(ended.endReason).toBe("arrived");
	});
});

describe("advance: 종료", () => {
	it('"end"를 받으면 바로 ended(user)', () => {
		const state = step(caughtB(), at(5), busBoardsAt(at(5)), { kind: "end" });
		expect(state.stage).toBe("ended");
		expect(state.endReason).toBe("user");
	});

	it("끝난 세션은 어떤 입력에도 그대로다", () => {
		const ended = step(caughtB(), at(5), busBoardsAt(at(5)), { kind: "end" });
		const inputs: (SessionInput | undefined)[] = [
			undefined,
			{ kind: "boarded" },
			{ kind: "next" },
			{ kind: "end" },
		];
		for (const input of inputs) {
			expect(step(ended, at(6), busBoardsAt(at(6)), input)).toBe(ended);
		}
	});

	it("시작 후 3시간이 지나면 ended(timeout)", () => {
		const before = step(caughtB(), at(179, 59), busBoardsAt(at(179, 59)));
		expect(before.stage).not.toBe("ended");
		const after = step(caughtB(), at(180), busBoardsAt(at(180)));
		expect(after.stage).toBe("ended");
		expect(after.endReason).toBe("timeout");
	});
});

describe("advance: 처음 목적지 도착과 seq", () => {
	it("initialDestinationEtaAt은 처음 값이 생길 때 한 번만 정한다", () => {
		const noBoard = fakeBoards(at(0), [[altBusLeg, altView]]);
		const first = step(started(), at(0), noBoard);
		expect(first.initialDestinationEtaAt).toBeNull();

		const second = step(first, at(1), busBoardsAt(at(1)));
		expect(second.initialDestinationEtaAt).toBe(at(34));

		const later = busBoardsAt(at(2), {
			board: stopBoard([vehicle("B", at(20))]),
		});
		const third = step(second, at(2), later);
		expect(third.estimates[0]?.destinationEtaAt).toBe(at(37));
		expect(third.initialDestinationEtaAt).toBe(at(34));
	});

	it("seq는 바꾸지 않는다", () => {
		const state = { ...caughtB(), seq: 7 };
		expect(step(state, at(5), busBoardsAt(at(5))).seq).toBe(7);
		expect(
			step(state, at(5), busBoardsAt(at(5)), { kind: "boarded" }).seq
		).toBe(7);
	});
});

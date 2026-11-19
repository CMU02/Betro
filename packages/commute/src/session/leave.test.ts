import { describe, expect, it } from "bun:test";
import type { CommuteConfig } from "../config";
import { commuteConfig } from "../config";
import type { BusLeg, CommutePlan, Route } from "../plan";
import type { LegEstimate } from "./estimate";
import type { LeaveView } from "./leave";
import { nextLeaveView } from "./leave";
import type { SessionState } from "./stage";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const BASE = Date.UTC(2026, 10, 9, 23, 0);
const config = commuteConfig({});

/** 08:mm:ss */
function at(minute: number, second = 0): number {
	return BASE + minute * MINUTE_MS + second * SECOND_MS;
}

const busLeg: BusLeg = {
	alight: { name: "흑석동효사정앞", seq: 42, stop: "seoul-bus:119000030" },
	board: { name: "노량진역", seq: 39, stop: "seoul-bus:119000011" },
	line: "seoul-bus:100100290",
	lineName: "6411",
	mode: "bus",
};

/** 첫 도보 5분. */
const primary: Route = { legs: [busLeg], rank: 0, walkMinutes: [5, 3] };

const plan: CommutePlan = {
	enabled: true,
	planId: "0b9f3a52-6d1c-4f0e-9a51-1c7f7b0f4a10",
	routes: [primary],
	schedule: {
		days: [1, 2, 3, 4, 5],
		includeHolidays: false,
		leadMinutes: 10,
		leaveMinute: 8 * 60 + 10,
		timezone: "Asia/Seoul",
	},
};

function legEstimate(overrides: Partial<LegEstimate> = {}): LegEstimate {
	return {
		alightEtaAt: at(40),
		boardEtaAt: at(18),
		etaState: "live",
		method: "official",
		positionState: "live",
		stopsAway: 2,
		vehicleId: "A",
		...overrides,
	};
}

/** 나가는 시각 08:10, 도보 단계, 첫 구간에 A를 잡은 상태. */
function stateOf(
	leg: Partial<LegEstimate> = {},
	overrides: Partial<SessionState> = {}
): SessionState {
	return {
		boardedBy: [null],
		earlyBoardFrom: null,
		endReason: null,
		estimates: [
			{ destinationEtaAt: at(40), legs: [legEstimate(leg)], rank: 0 },
		],
		fixed: ["A"],
		initialDestinationEtaAt: at(40),
		leave: null,
		leaveAt: at(10),
		legIndex: 0,
		passed: null,
		planId: plan.planId,
		readyAt: at(15),
		seq: 0,
		sessionId: "session-1",
		skip: [],
		stage: "walk",
		startedAt: at(0),
		...overrides,
	};
}

function judge(
	prev: LeaveView | null,
	now: number,
	boardEtaAt: number | null,
	state: SessionState = stateOf({ boardEtaAt }),
	withConfig: CommuteConfig = config
): LeaveView | null {
	return nextLeaveView(prev, state, plan, now, withConfig);
}

describe("nextLeaveView", () => {
	it("여유 있음", () => {
		expect(judge(null, at(5), at(18))).toEqual({
			safeLeaveAt: null,
			slack: "roomy",
			vehicleId: "A",
		});
	});

	it("빠듯, 당긴 시각", () => {
		// 08:16 − 3분 − 5분 = 08:08
		expect(judge(null, at(5), at(16))).toEqual({
			safeLeaveAt: at(8),
			slack: "tight",
			vehicleId: "A",
		});
	});

	it("분 단위 내림", () => {
		expect(judge(null, at(5), at(16, 30))?.safeLeaveAt).toBe(at(8));
	});

	it("깜빡임 방지로 tight 유지, 상한 leaveAt−60초", () => {
		const prev: LeaveView = {
			safeLeaveAt: at(9),
			slack: "tight",
			vehicleId: "A",
		};
		// 계산값 08:10:20은 leaveAt보다 20초 늦을 뿐이라 tight를 유지한다.
		expect(judge(prev, at(5), at(18, 20))).toEqual({
			safeLeaveAt: at(9),
			slack: "tight",
			vehicleId: "A",
		});
	});

	it("30초 넘게 늦어지면 roomy", () => {
		const prev: LeaveView = {
			safeLeaveAt: at(9),
			slack: "tight",
			vehicleId: "A",
		};
		expect(judge(prev, at(5), at(18, 40))?.slack).toBe("roomy");
	});

	it("차량이 바뀌면 깜빡임 방지 초기화", () => {
		const prev: LeaveView = {
			safeLeaveAt: at(9),
			slack: "tight",
			vehicleId: "B",
		};
		expect(judge(prev, at(5), at(18, 20))?.slack).toBe("roomy");
	});

	it("당기는 폭 5분 초과면 safeLeaveAt null", () => {
		// 08:12 − 3분 − 5분 = 08:04, 등록 시각보다 6분 이름
		expect(judge(null, at(3), at(12))).toEqual({
			safeLeaveAt: null,
			slack: "tight",
			vehicleId: "A",
		});
	});

	it("계산할 수 없으면 null", () => {
		const boardEtaAt = at(16);
		const noMargin = commuteConfig({
			COMMUTE_LEAVE_MARGIN_SEC: '{"bus":0,"subway":0}',
		});
		const cases: [string, number, SessionState, CommuteConfig][] = [
			["now = leaveAt", at(10), stateOf({ boardEtaAt }), config],
			[
				"시간표 추정",
				at(5),
				stateOf({ boardEtaAt, etaState: "estimated" }),
				config,
			],
			[
				"위치 묵음",
				at(5),
				stateOf({ boardEtaAt, positionState: "stale" }),
				config,
			],
			[
				"차량이 지나감",
				at(5),
				stateOf({ boardEtaAt }, { passed: { lineName: "6411" } }),
				config,
			],
			["boardEtaAt 없음", at(5), stateOf({ boardEtaAt: null }), config],
			["차량 못 잡음", at(5), stateOf({ boardEtaAt, vehicleId: null }), config],
			["대기 단계", at(5), stateOf({ boardEtaAt }, { stage: "wait" }), config],
			["환승 구간", at(5), stateOf({ boardEtaAt }, { legIndex: 1 }), config],
			["여유 폭 0", at(5), stateOf({ boardEtaAt }), noMargin],
		];
		for (const [label, now, state, withConfig] of cases) {
			expect({
				label,
				view: judge(null, now, boardEtaAt, state, withConfig),
			}).toEqual({ label, view: null });
		}
	});
});

import { describe, expect, it } from "bun:test";
import { commuteConfig } from "../config";
import type { BusLeg, CommutePlan, Route, SubwayLeg } from "../plan";
import type { ContentState } from "./content";
import { activityAttributes, buildContent, decideSend } from "./content";
import type { LegEstimate, RouteEstimate } from "./estimate";
import type { SessionState } from "./stage";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const BASE = Date.UTC(2026, 10, 9, 23, 0);
const config = commuteConfig({});

/** 08:mm:ss */
function at(minute: number, second = 0): number {
	return BASE + minute * MINUTE_MS + second * SECOND_MS;
}

function epoch(ms: number): number {
	return Math.floor(ms / SECOND_MS);
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

const altSubwayLeg: SubwayLeg = {
	alight: { name: "역삼", stop: "seoul-subway:1002000221" },
	board: { name: "강남", stop: "seoul-subway:1002000222" },
	direction: "down",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};

const primary: Route = { legs: [busLeg], rank: 0, walkMinutes: [5, 3] };
const alt1: Route = { legs: [altBusLeg], rank: 1, walkMinutes: [2, 4] };
const alt2: Route = { legs: [altSubwayLeg], rank: 2, walkMinutes: [6, 4] };

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

const plan = planOf([primary, alt1, alt2]);

function legEstimate(overrides: Partial<LegEstimate> = {}): LegEstimate {
	return {
		alightEtaAt: at(40),
		boardEtaAt: at(25),
		etaState: "live",
		method: "official",
		positionState: "live",
		stopsAway: 2,
		vehicleId: "B",
		...overrides,
	};
}

function routeEstimate(
	rank: number,
	destinationEtaAt: number | null,
	leg: Partial<LegEstimate> = {}
): RouteEstimate {
	return { destinationEtaAt, legs: [legEstimate(leg)], rank };
}

function stateOf(overrides: Partial<SessionState> = {}): SessionState {
	return {
		boardedBy: [null],
		endReason: null,
		estimates: [routeEstimate(0, at(40))],
		fixed: ["B"],
		initialDestinationEtaAt: at(40),
		leaveAt: at(10),
		legIndex: 0,
		passed: null,
		planId: plan.planId,
		readyAt: at(15),
		seq: 4,
		sessionId: "session-1",
		skip: [],
		stage: "walk",
		startedAt: at(0),
		...overrides,
	};
}

function content(overrides: Partial<ContentState> = {}): ContentState {
	return {
		delayMinutes: 0,
		destinationEtaEpoch: epoch(at(40)),
		etaEpoch: epoch(at(25)),
		etaState: "live",
		leaveEpoch: epoch(at(10)),
		legCount: 1,
		legIndex: 0,
		lineName: "6411",
		mode: "bus",
		passed: null,
		positionState: "live",
		sentAt: epoch(at(1)),
		seq: 5,
		stage: "walk",
		stopName: "노량진역",
		stopsAway: 2,
		suggestion: null,
		v: 1,
		...overrides,
	};
}

describe("buildContent", () => {
	it("walk 첫 구간은 승차 정류장, 나가는 시각, 승차 도착을 낸다", () => {
		const result = buildContent(stateOf(), plan, at(1), config);
		expect(result).toEqual(content());
	});

	it("seq는 state.seq + 1, sentAt은 epoch 초", () => {
		const result = buildContent(stateOf({ seq: 9 }), plan, at(3, 30), config);
		expect(result.seq).toBe(10);
		expect(result.sentAt).toBe(epoch(at(3, 30)));
	});

	it("ride는 하차 정류장, leaveEpoch null, 하차까지 남은 정거장", () => {
		const state = stateOf({
			boardedBy: ["user"],
			estimates: [
				routeEstimate(0, at(40), {
					alightEtaAt: at(31),
					boardEtaAt: null,
					stopsAway: 6,
				}),
			],
			stage: "ride",
		});
		const result = buildContent(state, plan, at(25), config);
		expect(result.stage).toBe("ride");
		expect(result.stopName).toBe("흑석동효사정앞");
		expect(result.leaveEpoch).toBeNull();
		expect(result.stopsAway).toBe(6);
		expect(result.etaEpoch).toBe(epoch(at(31)));
	});

	it("첫 구간이 아니거나 wait이면 leaveEpoch는 null", () => {
		const result = buildContent(
			stateOf({ stage: "wait" }),
			plan,
			at(14),
			config
		);
		expect(result.leaveEpoch).toBeNull();
		expect(result.stopName).toBe("노량진역");
	});

	it("지연: 처음 08:34, 지금 08:39 이면 5분, 더 일러지면 0", () => {
		const late = stateOf({
			estimates: [routeEstimate(0, at(39))],
			initialDestinationEtaAt: at(34),
		});
		expect(buildContent(late, plan, at(1), config).delayMinutes).toBe(5);
		const early = stateOf({
			estimates: [routeEstimate(0, at(31))],
			initialDestinationEtaAt: at(34),
		});
		expect(buildContent(early, plan, at(1), config).delayMinutes).toBe(0);
	});

	it("목적지 도착을 모르면 지연 0, destinationEtaEpoch null", () => {
		const state = stateOf({ estimates: [routeEstimate(0, null)] });
		const result = buildContent(state, plan, at(1), config);
		expect(result.delayMinutes).toBe(0);
		expect(result.destinationEtaEpoch).toBeNull();
	});

	it("추정 상태와 위치 상태를 따로 담는다", () => {
		const state = stateOf({
			estimates: [
				routeEstimate(0, at(40), {
					etaState: "estimated",
					method: "headway",
					positionState: "stale",
					stopsAway: null,
				}),
			],
		});
		const result = buildContent(state, plan, at(1), config);
		expect(result.etaState).toBe("estimated");
		expect(result.positionState).toBe("stale");
		expect(result.stopsAway).toBeNull();
	});

	it("passed를 그대로 옮긴다", () => {
		const result = buildContent(
			stateOf({ passed: { lineName: "6411" } }),
			plan,
			at(1),
			config
		);
		expect(result.passed).toEqual({ lineName: "6411" });
	});

	it("제안: 기본 08:40, 대안 08:34(6분 이득)이면 rank 1, 대안 첫 구간 수단", () => {
		const state = stateOf({
			estimates: [
				routeEstimate(0, at(40)),
				routeEstimate(1, at(34), { boardEtaAt: at(16) }),
			],
		});
		const result = buildContent(state, plan, at(1), config);
		expect(result.suggestion).toEqual({
			boardEtaEpoch: epoch(at(16)),
			lineName: "360",
			mode: "bus",
			rank: 1,
			savesMinutes: 6,
		});
	});

	it("제안: 대안 첫 구간이 지하철이면 mode는 subway", () => {
		const state = stateOf({
			estimates: [
				routeEstimate(0, at(40)),
				routeEstimate(2, at(35), { boardEtaAt: at(18) }),
			],
		});
		const result = buildContent(state, plan, at(1), config);
		expect(result.suggestion?.mode).toBe("subway");
		expect(result.suggestion?.lineName).toBe("2호선");
		expect(result.suggestion?.rank).toBe(2);
	});

	it("제안: 이득이 2분이면 제안하지 않는다, 3분이면 한다", () => {
		const small = stateOf({
			estimates: [routeEstimate(0, at(40)), routeEstimate(1, at(38))],
		});
		expect(buildContent(small, plan, at(1), config).suggestion).toBeNull();
		const enough = stateOf({
			estimates: [routeEstimate(0, at(40)), routeEstimate(1, at(37))],
		});
		expect(
			buildContent(enough, plan, at(1), config).suggestion?.savesMinutes
		).toBe(3);
	});

	it("제안: 대안이 둘이면 더 빠른 쪽", () => {
		const state = stateOf({
			estimates: [
				routeEstimate(0, at(40)),
				routeEstimate(1, at(35)),
				routeEstimate(2, at(33)),
			],
		});
		const result = buildContent(state, plan, at(1), config);
		expect(result.suggestion?.rank).toBe(2);
		expect(result.suggestion?.savesMinutes).toBe(7);
	});

	it("제안: ride에서는 null", () => {
		const state = stateOf({
			estimates: [routeEstimate(0, at(40)), routeEstimate(1, at(30))],
			stage: "ride",
		});
		expect(buildContent(state, plan, at(25), config).suggestion).toBeNull();
	});

	it("제안: 대안 첫 구간이 estimated면 null", () => {
		const state = stateOf({
			estimates: [
				routeEstimate(0, at(40)),
				routeEstimate(1, at(30), { etaState: "estimated" }),
			],
		});
		expect(buildContent(state, plan, at(1), config).suggestion).toBeNull();
	});

	it("제안: 기본 경로나 대안의 목적지 도착이 null이면 null", () => {
		const noPrimary = stateOf({
			estimates: [routeEstimate(0, null), routeEstimate(1, at(30))],
		});
		expect(buildContent(noPrimary, plan, at(1), config).suggestion).toBeNull();
		const noAlt = stateOf({
			estimates: [routeEstimate(0, at(40)), routeEstimate(1, null)],
		});
		expect(buildContent(noAlt, plan, at(1), config).suggestion).toBeNull();
	});

	it("직렬화한 값이 2KB보다 작고, 문자열 값은 정해진 낱말이거나 이름이다", () => {
		const state = stateOf({
			estimates: [
				routeEstimate(0, at(40)),
				routeEstimate(1, at(30), { boardEtaAt: at(16) }),
			],
			passed: { lineName: "6411" },
		});
		const result = buildContent(state, plan, at(1), config);
		expect(JSON.stringify(result).length).toBeLessThan(2048);
		const allowed = new Set([
			"walk",
			"wait",
			"ride",
			"arrived",
			"ended",
			"bus",
			"subway",
			"live",
			"stale",
			"none",
			"estimated",
		]);
		const names = new Set(["노량진역", "6411", "360"]);
		const strings: string[] = [];
		const collect = (value: unknown): void => {
			if (typeof value === "string") {
				strings.push(value);
			} else if (typeof value === "object" && value !== null) {
				for (const inner of Object.values(value)) {
					collect(inner);
				}
			}
		};
		collect(result);
		for (const text of strings) {
			expect(allowed.has(text) || names.has(text)).toBe(true);
		}
	});
});

describe("decideSend", () => {
	const NOW = at(2);

	it("prev가 null이면 우선순위 10 stage", () => {
		expect(decideSend(null, content(), null, NOW, config)).toEqual({
			priority: 10,
			reason: "stage",
			send: true,
		});
	});

	it("정거장 수만 바뀌면 5 change", () => {
		expect(
			decideSend(
				content(),
				content({ stopsAway: 1 }),
				NOW - 30_000,
				NOW,
				config
			)
		).toEqual({ priority: 5, reason: "change", send: true });
	});

	it("단계가 바뀌면 10 stage", () => {
		expect(
			decideSend(
				content(),
				content({ stage: "wait" }),
				NOW - 30_000,
				NOW,
				config
			)
		).toEqual({ priority: 10, reason: "stage", send: true });
	});

	it("구간, 노선, passed 유무가 바뀌면 10 stage", () => {
		const last = NOW - 30_000;
		expect(
			decideSend(content(), content({ legIndex: 1 }), last, NOW, config).send
		).toBe(true);
		expect(
			decideSend(content(), content({ lineName: "360" }), last, NOW, config)
		).toMatchObject({ priority: 10, reason: "stage" });
		expect(
			decideSend(
				content(),
				content({ passed: { lineName: "6411" } }),
				last,
				NOW,
				config
			)
		).toMatchObject({ priority: 10, reason: "stage" });
	});

	it("제안이 생기거나 사라지거나 rank가 바뀌면 10 stage, savesMinutes만 바뀌면 5 change", () => {
		const last = NOW - 30_000;
		const suggestion = {
			boardEtaEpoch: epoch(at(16)),
			lineName: "360",
			mode: "bus" as const,
			rank: 1,
			savesMinutes: 6,
		};
		expect(
			decideSend(content(), content({ suggestion }), last, NOW, config)
		).toMatchObject({ priority: 10, reason: "stage" });
		expect(
			decideSend(content({ suggestion }), content(), last, NOW, config)
		).toMatchObject({ priority: 10, reason: "stage" });
		expect(
			decideSend(
				content({ suggestion }),
				content({ suggestion: { ...suggestion, rank: 2 } }),
				last,
				NOW,
				config
			)
		).toMatchObject({ priority: 10, reason: "stage" });
		expect(
			decideSend(
				content({ suggestion }),
				content({ suggestion: { ...suggestion, savesMinutes: 7 } }),
				last,
				NOW,
				config
			)
		).toEqual({ priority: 5, reason: "change", send: true });
	});

	it("분 단위로 바뀌는 값과 상태가 바뀌면 5 change", () => {
		const last = NOW - 30_000;
		const base = epoch(at(25));
		const prev = content({ etaEpoch: base });
		for (const next of [
			content({ etaEpoch: base + 60 }),
			content({ positionState: "stale" }),
			content({ etaState: "estimated" }),
			content({ delayMinutes: 2 }),
			content({ destinationEtaEpoch: epoch(at(41)) }),
		]) {
			expect(decideSend(prev, next, last, NOW, config)).toEqual({
				priority: 5,
				reason: "change",
				send: true,
			});
		}
	});

	it("초만 바뀌고 분이 같으면 보내지 않는다", () => {
		const base = epoch(at(25));
		const prev = content({ etaEpoch: base });
		const next = content({ etaEpoch: base + 20, sentAt: prev.sentAt + 30 });
		expect(decideSend(prev, next, NOW - 30_000, NOW, config)).toEqual({
			send: false,
		});
	});

	it("값이 같아도 110초가 지나면 heartbeat, 109초면 보내지 않는다", () => {
		expect(
			decideSend(content(), content(), NOW - 110_000, NOW, config)
		).toEqual({ priority: 5, reason: "heartbeat", send: true });
		expect(
			decideSend(content(), content(), NOW - 109_000, NOW, config)
		).toEqual({ send: false });
	});

	it("lastSentAt이 null이면 heartbeat로 보낸다", () => {
		expect(decideSend(content(), content(), null, NOW, config)).toEqual({
			priority: 5,
			reason: "heartbeat",
			send: true,
		});
	});
});

describe("activityAttributes", () => {
	it("planId와 sessionId만 낸다", () => {
		expect(activityAttributes(stateOf())).toEqual({
			planId: plan.planId,
			sessionId: "session-1",
		});
	});
});

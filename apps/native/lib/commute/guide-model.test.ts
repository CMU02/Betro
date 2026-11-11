import type { CommutePlan, Leg, Route } from "@Betro/commute/plan";
import { describe, expect, it } from "bun:test";

import { t } from "../i18n/t";
import type { Place } from "../places/places";
import { headerOf } from "../places/plan-headers";
import fixture from "./__fixtures__/lock-screen-cases.json";
import type { ContentState } from "./content-state";
import { guideModel, guideTitle, sessionStripModel } from "./guide-model";
import { lockScreenModel } from "./lock-screen-model";
import type { ActiveSessionView, SessionRouteView } from "./session-client";

const NOW = 1_794_265_200; // 2026-11-10 08:00 KST
const TIMEZONE = "Asia/Seoul";
const PLAN_ID = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";
const OTHER_PLAN_ID = "0b6c1f0e-3f7a-4c1d-9e2b-5a4d3c2b1a00";

const BUS_341: Leg = {
	alight: { name: "잠실역.롯데월드", seq: 10, stop: "seoul-bus:200000" },
	board: { name: "천호역.현대백화점", seq: 3, stop: "seoul-bus:100000" },
	line: "seoul-bus:100100341",
	lineName: "341",
	mode: "bus",
};
const LINE_2: Leg = {
	alight: { name: "강남", stop: "seoul-subway:0222" },
	board: { name: "잠실", stop: "seoul-subway:0216" },
	direction: "down",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};
const BUS_360: Leg = {
	alight: { name: "강남역", seq: 30, stop: "seoul-bus:300000" },
	board: { name: "천호역.현대백화점", seq: 5, stop: "seoul-bus:100001" },
	line: "seoul-bus:100100360",
	lineName: "360",
	mode: "bus",
};
const LINE_8: Leg = {
	alight: { name: "잠실", stop: "seoul-subway:2815" },
	board: { name: "천호", stop: "seoul-subway:2812" },
	direction: "down",
	line: "seoul-subway:line8",
	lineName: "8호선",
	mode: "subway",
};

function routeOf(rank: number, legs: Leg[]): Route {
	return { legs, rank, walkMinutes: legs.map(() => 5).concat(5) };
}

function placeOf(overrides: Partial<CommutePlan["schedule"]> = {}): Place {
	const plan: CommutePlan = {
		enabled: true,
		planId: PLAN_ID,
		// rank 순서가 아닌 저장 순서
		routes: [
			routeOf(0, [BUS_341, LINE_2]),
			routeOf(2, [LINE_8, LINE_2]),
			routeOf(1, [BUS_360]),
		],
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute: 8 * 60 + 10,
			timezone: TIMEZONE,
			...overrides,
		},
	};
	return {
		id: "place-1",
		kind: "work",
		name: "",
		plan,
		sync: "synced",
		updatedAt: 1,
	};
}

const BASE_CONTENT = (fixture.cases[4] as { state: ContentState }).state;

/** 기본 경로(341 → 2호선)의 첫 구간 대기 */
const CONTENT: ContentState = {
	...BASE_CONTENT,
	destinationEtaEpoch: NOW + 40 * 60,
	etaEpoch: NOW + 3 * 60,
	legCount: 2,
	legIndex: 0,
	lineName: "341",
	mode: "bus",
	nextLegs: [
		{
			boardEtaEpoch: NOW + 20 * 60,
			etaState: "estimated",
			lineName: "2호선",
			mode: "subway",
			stopName: "잠실",
		},
	],
	stage: "wait",
	stopName: "천호역.현대백화점",
	stopsAway: 2,
};

function view(
	rank: number,
	destinationEtaEpoch: number | null,
	overrides: Partial<SessionRouteView> = {}
): SessionRouteView {
	return {
		boardEtaEpoch: NOW + 4 * 60,
		destinationEtaEpoch,
		etaState: "live",
		positionState: "live",
		rank,
		stopsAway: 3,
		...overrides,
	};
}

function sessionOf(
	routes: SessionRouteView[],
	overrides: Partial<ActiveSessionView> = {}
): ActiveSessionView {
	return {
		content: CONTENT,
		planId: PLAN_ID,
		routes,
		sessionId: "session-1",
		...overrides,
	};
}

const MAIN_ETA = NOW + 40 * 60;

describe("guideModel idle", () => {
	it("has the next start and every registered route when no session runs", () => {
		const model = guideModel({
			now: NOW,
			place: placeOf(),
			session: null,
			t,
			timezone: TIMEZONE,
		});
		expect(model).toEqual({
			kind: "idle",
			next: "평일 08:10에 나가요 · 08:00부터 잠금화면에 떠요",
			routes: [
				{
					badge: [
						{ mode: "bus", name: "341", region: "seoul", routeType: "" },
						{ line: "seoul-subway:line2", mode: "subway", name: "2호선" },
					],
					label: "기본 경로 · 341번 → 2호선",
					rank: 0,
					summary: "천호역.현대백화점 → 잠실 → 강남",
				},
				{
					badge: [{ mode: "bus", name: "360", region: "seoul", routeType: "" }],
					label: "대안 · 360번",
					rank: 1,
					summary: "천호역.현대백화점 → 강남역",
				},
				{
					badge: [
						{ line: "seoul-subway:line8", mode: "subway", name: "8호선" },
						{ line: "seoul-subway:line2", mode: "subway", name: "2호선" },
					],
					label: "대안 · 8호선 → 2호선",
					rank: 2,
					summary: "천호 → 잠실 → 강남",
				},
			],
		});
	});

	it("starts the day before when the lead time crosses midnight", () => {
		const model = guideModel({
			now: NOW,
			place: placeOf({ leaveMinute: 5 }),
			session: null,
			t,
			timezone: TIMEZONE,
		});
		expect(model.kind === "idle" && model.next).toBe(
			"평일 00:05에 나가요 · 전날 23:55부터 잠금화면에 떠요"
		);
	});

	it("uses the plan's own lead minutes", () => {
		const model = guideModel({
			now: NOW,
			place: placeOf({ days: [1, 3, 5], leadMinutes: 30 }),
			session: null,
			t,
			timezone: TIMEZONE,
		});
		expect(model.kind === "idle" && model.next).toBe(
			"월·수·금 08:10에 나가요 · 07:40부터 잠금화면에 떠요"
		);
	});

	it("is idle when the running session belongs to another place", () => {
		const model = guideModel({
			now: NOW,
			place: placeOf(),
			session: sessionOf([view(0, MAIN_ETA)], { planId: OTHER_PLAN_ID }),
			t,
			timezone: TIMEZONE,
		});
		expect(model.kind).toBe("idle");
	});
});

describe("guideModel active", () => {
	const place = placeOf();

	function active(routes: SessionRouteView[], content = CONTENT) {
		const model = guideModel({
			now: NOW,
			place,
			session: sessionOf(routes, { content }),
			t,
			timezone: TIMEZONE,
		});
		if (model.kind !== "active") {
			throw new Error("expected an active guide");
		}
		return model;
	}

	it("draws the same card as the lock screen", () => {
		const model = active([view(0, MAIN_ETA)]);
		expect(model.card).toEqual(
			lockScreenModel(CONTENT, {
				header: headerOf(place, t),
				now: NOW,
				platform: "ios",
				t,
				timezone: TIMEZONE,
			})
		);
		expect(model.card.header).toBe("출근 · 회사까지");
		expect(model.card.status).toBe("2정거장 전");
		expect(model.sessionId).toBe("session-1");
	});

	it("shows one next-leg line on the first leg of a two-leg route", () => {
		const model = active([view(0, MAIN_ETA)]);
		expect(model.card.nextLegs).toEqual([
			{ lineName: "2호선", mode: "subway", text: "잠실 · 약 08:20 승차" },
		]);
		expect(model.card.moreLegs).toBeNull();
		expect(model.cardBadge).toEqual({
			mode: "bus",
			name: "341",
			region: "seoul",
			routeType: "",
		});
		expect(model.nextLegBadges).toEqual([
			{ line: "seoul-subway:line2", mode: "subway", name: "2호선" },
		]);
	});

	it("takes the badge of the leg in progress", () => {
		const model = active([view(0, MAIN_ETA)], {
			...CONTENT,
			legIndex: 1,
			lineName: "2호선",
			mode: "subway",
			nextLegs: [],
		});
		expect(model.cardBadge).toEqual({
			line: "seoul-subway:line2",
			mode: "subway",
			name: "2호선",
		});
		expect(model.nextLegBadges).toEqual([]);
	});

	it("falls back to the pushed line when the leg is not in the place", () => {
		const model = active([view(0, MAIN_ETA)], {
			...CONTENT,
			legIndex: 3,
			lineName: "9호선",
			mode: "subway",
			nextLegs: [],
		});
		expect(model.cardBadge).toEqual({
			line: "",
			mode: "subway",
			name: "9호선",
		});
	});

	it("lists the registered alternatives in rank order with the difference", () => {
		const model = active([
			view(0, MAIN_ETA),
			view(1, MAIN_ETA - 6 * 60),
			view(2, MAIN_ETA + 3 * 60, { etaState: "estimated" }),
		]);
		expect(model.others).toEqual([
			{
				arrival: "08:34 도착",
				badge: [{ mode: "bus", name: "360", region: "seoul", routeType: "" }],
				diff: "6분 빨리",
				rank: 1,
				stops: "천호역.현대백화점 → 강남역",
				tag: "live",
				tagLabel: "실시간",
				title: "360번",
			},
			{
				arrival: "08:43 도착",
				badge: [
					{ line: "seoul-subway:line8", mode: "subway", name: "8호선" },
					{ line: "seoul-subway:line2", mode: "subway", name: "2호선" },
				],
				diff: "3분 늦게",
				rank: 2,
				stops: "천호 → 잠실 → 강남",
				tag: "estimated",
				tagLabel: "시간표 추정",
				title: "8호선 · 2호선",
			},
		]);
	});

	it("has no difference when an estimate is missing", () => {
		const altMissing = active([view(0, MAIN_ETA), view(1, null)]);
		expect(altMissing.others[0]?.arrival).toBeNull();
		expect(altMissing.others[0]?.diff).toBeNull();
		const mainMissing = active([view(0, null), view(1, MAIN_ETA - 6 * 60)]);
		expect(mainMissing.others[0]?.arrival).toBe("08:34 도착");
		expect(mainMissing.others[0]?.diff).toBeNull();
	});

	it("has no difference under a minute", () => {
		const model = active([view(0, MAIN_ETA), view(1, MAIN_ETA - 30)]);
		expect(model.others[0]?.diff).toBeNull();
	});

	it("reads an alternative without a server estimate as estimated with no times", () => {
		const model = active([view(0, MAIN_ETA)]);
		expect(model.others.map((row) => row.rank)).toEqual([1, 2]);
		expect(model.others[0]).toMatchObject({
			arrival: null,
			diff: null,
			tag: "estimated",
		});
	});

	it("tags a live time with a stale position as estimated", () => {
		const model = active([
			view(0, MAIN_ETA),
			view(1, MAIN_ETA, { positionState: "stale" }),
		]);
		expect(model.others[0]?.tag).toBe("estimated");
	});
});

describe("guideTitle", () => {
	it("names the place", () => {
		expect(guideTitle(placeOf(), t)).toBe("회사 가는 길");
	});
});

describe("sessionStripModel", () => {
	const place = placeOf();

	it("points at the place of the running session", () => {
		expect(
			sessionStripModel({
				now: NOW,
				places: [place],
				session: sessionOf([view(0, MAIN_ETA)]),
				t,
				timezone: TIMEZONE,
			})
		).toEqual({
			badge: { mode: "bus", name: "341", region: "seoul", routeType: "" },
			header: "출근 · 회사까지 안내 중",
			placeId: "place-1",
			status: "2정거장 전 · 3분",
			tag: "live",
			tagLabel: "실시간",
		});
	});

	it("leaves out the minutes when there is no time", () => {
		const strip = sessionStripModel({
			now: NOW,
			places: [place],
			session: sessionOf([], {
				content: { ...CONTENT, etaEpoch: null, stopsAway: null },
			}),
			t,
			timezone: TIMEZONE,
		});
		expect(strip?.status).toBe("위치 확인 중");
	});

	it("has no strip without a session or for a plan the device does not know", () => {
		expect(
			sessionStripModel({
				now: NOW,
				places: [place],
				session: null,
				t,
				timezone: TIMEZONE,
			})
		).toBeNull();
		expect(
			sessionStripModel({
				now: NOW,
				places: [place],
				session: sessionOf([], { planId: OTHER_PLAN_ID }),
				t,
				timezone: TIMEZONE,
			})
		).toBeNull();
	});
});

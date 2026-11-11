import type { CommutePlan, Leg, Route } from "@Betro/commute/plan";
import { describe, expect, it } from "bun:test";

import { t } from "../i18n/t";
import type { Place } from "../places/places";
import { headerOf } from "../places/plan-headers";
import type { LineBadgeInput } from "../transit/line-badge-model";
import fixture from "./__fixtures__/lock-screen-cases.json";
import type { ContentState } from "./content-state";
import {
	guideModel,
	guideTitle,
	nextLeaveDay,
	sessionStripModel,
} from "./guide-model";
import { lockScreenModel } from "./lock-screen-model";
import type { ActiveSessionView, SessionRouteView } from "./session-client";

const NOW = 1_794_265_200; // 2026-11-10(화) 08:00 KST
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
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
		busMeta: {},
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
			// NOW는 화요일 08:00, 오늘 안내가 막 시작한 시각이라 다음은 수요일(내일)이다.
			next: "내일 08:10에 나가요 · 08:00부터 잠금화면에 떠요",
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
			"내일 00:05에 나가요 · 전날 23:55부터 잠금화면에 떠요"
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
			"내일 08:10에 나가요 · 07:40부터 잠금화면에 떠요"
		);
	});

	it("does not promise the lock screen before the place reaches the server", () => {
		const pending = guideModel({
			now: NOW,
			place: { ...placeOf(), sync: "pending" },
			session: null,
			t,
			timezone: TIMEZONE,
		});
		const next = pending.kind === "idle" ? pending.next : "";
		expect(next).not.toContain("잠금화면에 떠요");
		expect(next).toBe("평일 08:10에 나가요 · 아직 서버에 저장되지 않았어요");

		const synced = guideModel({
			now: NOW,
			place: placeOf(),
			session: null,
			t,
			timezone: TIMEZONE,
		});
		expect(synced.kind === "idle" && synced.next).toBe(
			"내일 08:10에 나가요 · 08:00부터 잠금화면에 떠요"
		);
	});

	it("names the day the next start falls on: today, tomorrow or a weekday", () => {
		const nextAt = (now: number, overrides = {}) => {
			const model = guideModel({
				now,
				place: placeOf(overrides),
				session: null,
				t,
				timezone: TIMEZONE,
			});
			return model.kind === "idle" ? model.next : "";
		};
		// 화요일 07:59, 08:00(시작 정각), 08:01
		expect(nextAt(NOW - MINUTE)).toBe(
			"오늘 08:10에 나가요 · 08:00부터 잠금화면에 떠요"
		);
		expect(nextAt(NOW)).toBe("내일 08:10에 나가요 · 08:00부터 잠금화면에 떠요");
		expect(nextAt(NOW + MINUTE)).toBe(
			"내일 08:10에 나가요 · 08:00부터 잠금화면에 떠요"
		);
		// 금요일 18:00 → 토·일은 등록하지 않아 월요일
		expect(nextAt(NOW + 3 * DAY + 10 * HOUR)).toBe(
			"월 08:10에 나가요 · 08:00부터 잠금화면에 떠요"
		);
		// 월요일에만 등록했고 오늘(화)은 아니다 → 다음 주 월요일
		expect(nextAt(NOW - 2 * HOUR, { days: [1] })).toBe(
			"월 08:10에 나가요 · 08:00부터 잠금화면에 떠요"
		);
	});

	it("labels the leave day when the start is the evening before", () => {
		const nextAt = (now: number, days = [1, 2, 3, 4, 5]) => {
			const model = guideModel({
				now,
				place: placeOf({ days, leaveMinute: 5 }),
				session: null,
				t,
				timezone: TIMEZONE,
			});
			return model.kind === "idle" ? model.next : "";
		};
		const TUESDAY_2350 = NOW + 15 * HOUR + 50 * MINUTE;
		// 수요일 00:05에 나가고 화요일 23:55에 뜬다
		expect(nextAt(TUESDAY_2350)).toBe(
			"내일 00:05에 나가요 · 전날 23:55부터 잠금화면에 떠요"
		);
		// 23:55가 지나면 그다음 날(목요일 00:05)
		expect(nextAt(TUESDAY_2350 + 6 * MINUTE)).toBe(
			"목 00:05에 나가요 · 전날 23:55부터 잠금화면에 떠요"
		);
		// 금요일 23:56: 토·일 00:05는 등록하지 않았고 월요일 00:05(일요일 23:55 시작)
		expect(nextAt(TUESDAY_2350 + 3 * DAY + 6 * MINUTE)).toBe(
			"월 00:05에 나가요 · 전날 23:55부터 잠금화면에 떠요"
		);
		// 화요일에만 등록, 월요일 23:57: 이번 화요일 시작(23:55)이 지나 다음 주 화요일
		expect(nextAt(NOW - 8 * HOUR - 3 * MINUTE, [2])).toBe(
			"화 00:05에 나가요 · 전날 23:55부터 잠금화면에 떠요"
		);
	});

	it("finds no leave day when no weekday is registered", () => {
		const schedule = { days: [], leadMinutes: 10, leaveMinute: 490 };
		expect(nextLeaveDay(schedule, NOW, TIMEZONE)).toBeNull();
		expect(nextLeaveDay({ ...schedule, days: [2] }, NOW, TIMEZONE)).toEqual({
			offset: 7,
			weekday: 2,
		});
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

it("draws buses with the line meta kept on the device, idle and active", () => {
	const gyeonggi = { region: "gyeonggi", routeType: "8" } as const;
	const place: Place = {
		...placeOf(),
		busMeta: { [BUS_341.line]: gyeonggi, [BUS_360.line]: gyeonggi },
	};
	const bus341: LineBadgeInput = { mode: "bus", name: "341", ...gyeonggi };
	const bus360: LineBadgeInput = { mode: "bus", name: "360", ...gyeonggi };

	const idle = guideModel({
		now: NOW,
		place,
		session: null,
		t,
		timezone: TIMEZONE,
	});
	expect(
		idle.kind === "idle" ? idle.routes.map((r) => r.badge[0]) : []
	).toEqual([
		bus341,
		bus360,
		{ line: "seoul-subway:line8", mode: "subway", name: "8호선" },
	]);

	const active = guideModel({
		now: NOW,
		place,
		session: sessionOf([view(0, MAIN_ETA), view(1, MAIN_ETA)], {
			content: CONTENT,
		}),
		t,
		timezone: TIMEZONE,
	});
	expect(active.kind === "active" ? active.cardBadge : null).toEqual(bus341);
	expect(active.kind === "active" ? active.others[0]?.badge : null).toEqual([
		bus360,
	]);
});

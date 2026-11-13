import type { CommutePlan, Leg, Route } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import { lineBadgeModel } from "../transit/line-badge-model";
import {
	placeCardModel,
	placeCardSummary,
	scheduleLabel,
} from "./place-card-model";
import type { Place } from "./places";

const BUS_LEG: Leg = {
	alight: { name: "역삼역.포스코사거리", seq: 10, stop: "seoul-bus:200000" },
	board: { name: "잠실역.롯데월드", seq: 3, stop: "seoul-bus:100000" },
	line: "seoul-bus:100100341",
	lineName: "341",
	mode: "bus",
};

const SUBWAY_LEG: Leg = {
	alight: { name: "잠실", stop: "seoul-subway:0216" },
	board: { name: "역삼", stop: "seoul-subway:0222" },
	direction: "down",
	line: "seoul-subway:1002",
	lineName: "2호선",
	mode: "subway",
};

function routeOf(rank: number, legs: Leg[]): Route {
	return { legs, rank, walkMinutes: legs.map(() => 5).concat(5) };
}

function placeOf(
	overrides: Partial<Place> & { alternatives?: number; legs?: Leg[] } = {}
): Place {
	const { alternatives = 0, legs = [BUS_LEG], ...rest } = overrides;
	const routes = [routeOf(0, legs)];
	for (let rank = 1; rank <= alternatives; rank += 1) {
		routes.push(routeOf(rank, [BUS_LEG]));
	}
	const plan: CommutePlan = {
		enabled: true,
		planId: "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59",
		routes,
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute: 8 * 60 + 10,
			timezone: "Asia/Seoul",
		},
	};
	return {
		busMeta: {},
		id: "place-1",
		kind: "work",
		name: "회사",
		plan,
		sync: "synced",
		updatedAt: 1,
		...rest,
	};
}

it("names the weekday combinations", () => {
	expect(scheduleLabel([1, 2, 3, 4, 5], 490, t)).toBe("평일 08:10 출발");
	expect(scheduleLabel([6, 0], 600, t)).toBe("주말 10:00 출발");
	expect(scheduleLabel([0, 1, 2, 3, 4, 5, 6], 490, t)).toBe("매일 08:10 출발");
	expect(scheduleLabel([5, 1, 3], 490, t)).toBe("월·수·금 08:10 출발");
	expect(scheduleLabel([0, 6, 3], 490, t)).toBe("수·토·일 08:10 출발");
});

it("pads the time as 24-hour HH:MM", () => {
	expect(scheduleLabel([1], 5, t)).toBe("월 00:05 출발");
	expect(scheduleLabel([1], 1439, t)).toBe("월 23:59 출발");
});

it("counts alternatives and says nothing when there are none", () => {
	expect(placeCardModel(placeOf(), t).alternatives).toBeNull();
	expect(placeCardModel(placeOf({ alternatives: 1 }), t).alternatives).toBe(
		"대안 1개"
	);
	expect(placeCardModel(placeOf({ alternatives: 3 }), t).alternatives).toBe(
		"대안 3개"
	);
});

it("lists the legs of the main route only", () => {
	const model = placeCardModel(
		placeOf({ alternatives: 2, legs: [SUBWAY_LEG, BUS_LEG] }),
		t
	);
	expect(model.legs).toEqual([
		{
			badge: { line: "seoul-subway:1002", mode: "subway", name: "2호선" },
			from: "역삼",
			to: "잠실",
		},
		{
			badge: { mode: "bus", name: "341", region: "seoul", routeType: "" },
			from: "잠실역.롯데월드",
			to: "역삼역.포스코사거리",
		},
	]);
});

it("uses the rank 0 route even when it is not listed first", () => {
	const place = placeOf();
	place.plan.routes.unshift(routeOf(1, [SUBWAY_LEG]));
	expect(placeCardModel(place, t).legs).toHaveLength(1);
	expect(placeCardModel(place, t).legs[0]?.badge.mode).toBe("bus");
});

it("flags places that are not on the server yet", () => {
	expect(placeCardModel(placeOf({ sync: "pending" }), t).notSynced).toBe(true);
	expect(placeCardModel(placeOf(), t).notSynced).toBe(false);
});

it("titles by kind, by name for other, and by the imported name when empty", () => {
	expect(placeCardModel(placeOf(), t).title).toBe("회사");
	expect(
		placeCardModel(placeOf({ kind: "other", name: "헬스장" }), t).title
	).toBe("헬스장");
	expect(placeCardModel(placeOf({ kind: "other", name: "" }), t).title).toBe(
		"가져온 경로"
	);
	expect(placeCardModel(placeOf({ kind: "other", name: "  " }), t).title).toBe(
		"가져온 경로"
	);
});

it("builds the schedule text from the plan", () => {
	expect(placeCardModel(placeOf(), t).schedule).toBe("평일 08:10 출발");
});

it("joins the schedule and the alternative count into the card summary", () => {
	expect(placeCardSummary(placeCardModel(placeOf(), t), t)).toBe(
		"평일 08:10 출발"
	);
	expect(
		placeCardSummary(placeCardModel(placeOf({ alternatives: 2 }), t), t)
	).toBe("평일 08:10 출발 · 대안 2개");
});

const GYEONGGI_LEG: Leg = {
	...BUS_LEG,
	line: "seoul-bus:234000884",
	lineName: "M5107",
};

it("draws a Gyeonggi express bus with its region and the express color from the device's line meta", () => {
	const model = placeCardModel(
		placeOf({
			busMeta: { [GYEONGGI_LEG.line]: { region: "gyeonggi", routeType: "8" } },
			legs: [GYEONGGI_LEG, BUS_LEG],
		}),
		t
	);
	const badge = model.legs[0]?.badge;
	expect(badge).toEqual({
		mode: "bus",
		name: "M5107",
		region: "gyeonggi",
		routeType: "8",
	});
	expect(badge && lineBadgeModel(badge)).toMatchObject({
		colorToken: "bus/express",
		regionKey: "transit.region.gyeonggi",
	});
	// 맵에 없는 버스(맵이 생기기 전에 저장한 장소)는 지금처럼 기본 색이다.
	expect(model.legs[1]?.badge).toEqual({
		mode: "bus",
		name: "341",
		region: "seoul",
		routeType: "",
	});
});

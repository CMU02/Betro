import type { CommutePlan, Leg } from "@Betro/commute/plan";
import { beforeEach, describe, expect, it } from "bun:test";
import type { ContentState } from "../commute/content-state";
import type { ActiveSessionView } from "../commute/session-client";
import type { Place } from "../places/places";
import {
	getUserSelection,
	initialSelection,
	placeChips,
	resetUserSelection,
	routeOptions,
	setUserSelection,
	validSelection,
} from "./selection";

const KST = "Asia/Seoul";

function busLeg(lineName: string): Leg {
	return {
		alight: { name: "도착", seq: 5, stop: "seoul-bus:2" },
		board: { name: "출발", seq: 1, stop: "seoul-bus:1" },
		line: "seoul-bus:L",
		lineName,
		mode: "bus",
	} as Leg;
}

function subwayLeg(lineName: string): Leg {
	return {
		alight: { name: "도착역", stop: "seoul-subway:B" },
		board: { name: "출발역", stop: "seoul-subway:A" },
		direction: "up",
		line: "seoul-subway:2",
		lineName,
		mode: "subway",
	} as Leg;
}

function place(
	id: string,
	leaveMinute: number,
	routes: Leg[][] = [[busLeg("470"), subwayLeg("2호선")]]
): Place {
	const plan = {
		enabled: true,
		planId: `plan-${id}`,
		routes: routes.map((legs, rank) => ({
			legs,
			rank,
			walkMinutes: legs.map(() => 3),
		})),
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute,
			timezone: KST,
		},
	} as CommutePlan;
	return {
		busMeta: {},
		id,
		kind: "other",
		name: `장소-${id}`,
		plan,
		sync: "synced",
		updatedAt: 0,
	};
}

function session(
	planId: string,
	lineName: string,
	mode: "bus" | "subway"
): ActiveSessionView {
	return {
		content: { legIndex: 0, lineName, mode } as ContentState,
		planId,
		routes: [],
		sessionId: "s1",
	};
}

/** KST 시각의 epoch 밀리초 */
function kstEpoch(hour: number, minute: number): number {
	return Date.UTC(2026, 10, 20, hour - 9, minute);
}

beforeEach(() => {
	resetUserSelection();
});

describe("initialSelection", () => {
	it("returns null with no places", () => {
		expect(initialSelection([], null, kstEpoch(8, 5))).toBeNull();
	});

	it("prefers the active session's plan and route rank", () => {
		const home = place("home", 18 * 60);
		const work = place("work", 8 * 60, [
			[busLeg("470"), subwayLeg("2호선")],
			[busLeg("273"), subwayLeg("2호선")],
		]);
		expect(
			initialSelection(
				[home, work],
				session("plan-work", "273", "bus"),
				kstEpoch(18, 10)
			)
		).toEqual({ placeId: "work", rank: 1 });
		expect(
			initialSelection(
				[home, work],
				session("plan-work", "없는선", "bus"),
				kstEpoch(18, 10)
			)
		).toEqual({ placeId: "work", rank: 0 });
	});

	it("falls back to time when the session plan matches no place", () => {
		const home = place("home", 18 * 60);
		expect(
			initialSelection([home], session("plan-x", "470", "bus"), kstEpoch(8, 5))
		).toEqual({ placeId: "home", rank: 0 });
	});

	it("picks work at 08:05 and home at 18:10 by circular distance to leaveMinute", () => {
		const home = place("home", 18 * 60);
		const work = place("work", 8 * 60);
		expect(initialSelection([home, work], null, kstEpoch(8, 5))).toEqual({
			placeId: "work",
			rank: 0,
		});
		expect(initialSelection([home, work], null, kstEpoch(18, 10))).toEqual({
			placeId: "home",
			rank: 0,
		});
	});

	it("measures distance around midnight", () => {
		const late = place("late", 23 * 60 + 50);
		const noon = place("noon", 12 * 60);
		expect(initialSelection([noon, late], null, kstEpoch(0, 10))).toEqual({
			placeId: "late",
			rank: 0,
		});
	});

	it("uses each plan's own timezone", () => {
		const seoul = place("seoul", 8 * 60);
		const utc = place("utc", 23 * 60 + 6);
		utc.plan.schedule.timezone = "UTC";
		// 서울 08:05는 UTC 23:05라서 UTC 장소(23:06)가 1분, 서울 장소(08:00)가 5분이다.
		expect(initialSelection([seoul, utc], null, kstEpoch(8, 5))).toEqual({
			placeId: "utc",
			rank: 0,
		});
	});
});

describe("placeChips", () => {
	it("marks the selected place", () => {
		const places = [place("a", 480), place("b", 1080)];
		expect(placeChips(places, { placeId: "b", rank: 0 })).toEqual([
			{ id: "a", label: "장소-a", selected: false },
			{ id: "b", label: "장소-b", selected: true },
		]);
		expect(placeChips(places, null).every((chip) => !chip.selected)).toBe(true);
	});

	it("labels home, work and school places by their kind like the place cards", () => {
		const home = { ...place("h", 480), kind: "home" as const, name: "" };
		expect(placeChips([home], null)[0]?.label).toBe("집");
	});
});

describe("validSelection", () => {
	it("keeps a choice that still points at a place and route", () => {
		const work = place("work", 480, [[busLeg("470")], [busLeg("273")]]);
		expect(validSelection([work], { placeId: "work", rank: 1 })).toEqual({
			placeId: "work",
			rank: 1,
		});
	});

	it("drops a choice whose place or route rank is gone", () => {
		const work = place("work", 480);
		expect(validSelection([work], { placeId: "gone", rank: 0 })).toBeNull();
		expect(validSelection([work], { placeId: "work", rank: 3 })).toBeNull();
		expect(validSelection([work], null)).toBeNull();
	});
});

describe("routeOptions", () => {
	it("lists base then alternatives with line names", () => {
		const work = place("work", 480, [
			[busLeg("470"), subwayLeg("2호선")],
			[busLeg("273"), subwayLeg("2호선")],
		]);
		expect(routeOptions(work, { placeId: "work", rank: 1 })).toEqual([
			{ lineNames: ["470", "2호선"], rank: 0, selected: false },
			{ lineNames: ["273", "2호선"], rank: 1, selected: true },
		]);
	});

	it("selects nothing when the selection is on another place", () => {
		const work = place("work", 480);
		expect(
			routeOptions(work, { placeId: "home", rank: 0 }).some(
				(option) => option.selected
			)
		).toBe(false);
	});
});

describe("user selection", () => {
	it("keeps the chosen selection in module state", () => {
		expect(getUserSelection()).toBeNull();
		setUserSelection({ placeId: "a", rank: 2 });
		expect(getUserSelection()).toEqual({ placeId: "a", rank: 2 });
		resetUserSelection();
		expect(getUserSelection()).toBeNull();
	});
});

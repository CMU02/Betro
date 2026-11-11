import type { CommutePlan } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import type { Place, PlaceKind } from "./places";
import { headerOf, headersOf, planHeaderOf } from "./plan-headers";

function planOf(planId: string): CommutePlan {
	return {
		enabled: true,
		planId,
		routes: [
			{
				legs: [
					{
						alight: { name: "잠실역", seq: 10, stop: "seoul-bus:200000" },
						board: { name: "강변역", seq: 3, stop: "seoul-bus:100000" },
						line: "seoul-bus:100100341",
						lineName: "341",
						mode: "bus",
					},
				],
				rank: 0,
				walkMinutes: [5, 5],
			},
		],
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute: 485,
			timezone: "Asia/Seoul",
		},
	};
}

function place(kind: PlaceKind, name: string, planId: string): Place {
	return {
		busMeta: {},
		id: `place-${planId}`,
		kind,
		name,
		plan: planOf(planId),
		sync: "synced",
		updatedAt: 1000,
	};
}

const WORK = place("work", "회사", "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59");
const GYM = place("other", "헬스장", "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b");

it("writes the header for each kind", () => {
	expect(headerOf({ kind: "work", name: "회사" }, t)).toBe("출근 · 회사까지");
	expect(headerOf({ kind: "school", name: "학교" }, t)).toBe("등교 · 학교까지");
	expect(headerOf({ kind: "home", name: "집" }, t)).toBe("퇴근 · 집까지");
	expect(headerOf({ kind: "other", name: "헬스장" }, t)).toBe("헬스장까지");
});

it("uses the kind name instead of the stored name unless the kind is other", () => {
	expect(headerOf({ kind: "work", name: "본사" }, t)).toBe("출근 · 회사까지");
	expect(headerOf({ kind: "other", name: "  헬스장 " }, t)).toBe("헬스장까지");
});

it("names an imported place with an empty name", () => {
	expect(headerOf({ kind: "other", name: "" }, t)).toBe("가져온 경로까지");
});

it("maps every plan to its header", () => {
	expect(headersOf([WORK, GYM], t)).toEqual({
		[WORK.plan.planId]: "출근 · 회사까지",
		[GYM.plan.planId]: "헬스장까지",
	});
	expect(headersOf([], t)).toEqual({});
});

it("finds the header of one plan and returns null for an unknown plan", () => {
	const state = { pendingDeletes: [], places: [WORK, GYM] };
	expect(planHeaderOf(GYM.plan.planId, state, t)).toBe("헬스장까지");
	expect(
		planHeaderOf("00000000-0000-4000-8000-000000000000", state, t)
	).toBeNull();
});

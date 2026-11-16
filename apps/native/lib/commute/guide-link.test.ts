import type { CommutePlan } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import type { Place } from "../places/places";
import { guideLink, placeIdForPlan } from "./guide-link";

const PLAN_ID = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";

function place(id: string, planId: string): Place {
	return {
		busMeta: {},
		id,
		kind: "work",
		name: "회사",
		plan: { enabled: true, planId, routes: [] } as unknown as CommutePlan,
		sync: "synced",
		updatedAt: 1000,
	};
}

it("builds the link the lock screen card opens", () => {
	expect(guideLink(PLAN_ID)).toBe(`Betro://commute?plan=${PLAN_ID}`);
});

it("finds the place of the plan in the link", () => {
	const places = [place("gym", "other-plan"), place("work", PLAN_ID)];

	expect(placeIdForPlan(places, PLAN_ID)).toBe("work");
});

it("stays on the tab for a missing, empty or unknown plan", () => {
	const places = [place("work", PLAN_ID)];

	expect(placeIdForPlan(places, undefined)).toBeNull();
	expect(placeIdForPlan(places, "")).toBeNull();
	expect(placeIdForPlan(places, "sample")).toBeNull();
});

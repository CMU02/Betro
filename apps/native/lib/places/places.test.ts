import type { CommutePlan } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import {
	PLACES_KEY,
	type Place,
	type PlacesState,
	parsePlacesState,
	serializePlacesState,
} from "./places";

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

const WORK: Place = {
	id: "place-work",
	kind: "work",
	name: "회사",
	plan: planOf("7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59"),
	sync: "synced",
	updatedAt: 1_794_265_200_000,
};

const GYM: Place = {
	id: "place-gym",
	kind: "other",
	name: "헬스장",
	plan: planOf("1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b"),
	sync: "pending",
	updatedAt: 1_794_265_300_000,
};

const STATE: PlacesState = {
	pendingDeletes: ["3c4d5e6f-7081-492a-8b3c-4d5e6f708192"],
	places: [WORK, GYM],
};

const EMPTY: PlacesState = { pendingDeletes: [], places: [] };

it("uses the betro.places key", () => {
	expect(PLACES_KEY).toBe("betro.places");
});

it("reads back what it wrote", () => {
	expect(parsePlacesState(serializePlacesState(STATE))).toEqual(STATE);
});

it("drops only the place whose plan is broken", () => {
	const broken = { ...GYM, plan: { ...GYM.plan, routes: [] } };
	const raw = JSON.stringify({
		pendingDeletes: STATE.pendingDeletes,
		places: [WORK, broken],
		version: 1,
	});
	expect(parsePlacesState(raw)).toEqual({
		pendingDeletes: STATE.pendingDeletes,
		places: [WORK],
	});
});

it("drops places with broken fields and keeps valid pending deletes", () => {
	const raw = JSON.stringify({
		pendingDeletes: ["3c4d5e6f-7081-492a-8b3c-4d5e6f708192", 42, null],
		places: [{ ...WORK, kind: "castle" }, { ...GYM, sync: "maybe" }, "x", GYM],
		version: 1,
	});
	expect(parsePlacesState(raw)).toEqual({
		pendingDeletes: ["3c4d5e6f-7081-492a-8b3c-4d5e6f708192"],
		places: [GYM],
	});
});

it("keeps the first of two places with the same id or plan", () => {
	const sameId = {
		...GYM,
		plan: planOf("5e6f7081-92a3-4b4c-9d5e-6f708192a3b4"),
	};
	const samePlan = { ...GYM, id: "place-other" };
	const raw = JSON.stringify({
		pendingDeletes: [],
		places: [GYM, sameId, samePlan],
		version: 1,
	});
	expect(parsePlacesState(raw).places).toEqual([GYM]);
});

it("returns an empty state for version 2", () => {
	const raw = JSON.stringify({ ...STATE, version: 2 });
	expect(parsePlacesState(raw)).toEqual(EMPTY);
});

it("returns an empty state for null, broken JSON and other shapes", () => {
	expect(parsePlacesState(null)).toEqual(EMPTY);
	expect(parsePlacesState("{not json")).toEqual(EMPTY);
	expect(parsePlacesState("[]")).toEqual(EMPTY);
	expect(parsePlacesState(JSON.stringify({ version: 1 }))).toEqual(EMPTY);
});

import type { CommutePlan, Leg } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import type { Place } from "./places";
import { addLeg, emptyRoute } from "./route-draft";
import { createSetupDraft } from "./setup-draft";

const IDS = {
	placeId: "place-new",
	planId: "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59",
};

const BUS_LEG: Leg = {
	alight: { name: "역삼역.포스코사거리", seq: 5, stop: "seoul-bus:10005" },
	board: { name: "잠실역.롯데월드", seq: 3, stop: "seoul-bus:10003" },
	line: "seoul-bus:100100341",
	lineName: "341",
	mode: "bus",
};

const SUBWAY_LEG: Leg = {
	alight: { name: "강남", stop: "seoul-subway:1002000222" },
	board: { name: "잠실", stop: "seoul-subway:1002000216" },
	direction: "down",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};

function existingPlace(): Place {
	const plan: CommutePlan = {
		enabled: true,
		planId: "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b",
		// 저장된 순서가 rank 순이 아니어도 기본 경로가 먼저 와야 한다.
		routes: [
			{ legs: [SUBWAY_LEG], rank: 1, walkMinutes: [7, 4] },
			{ legs: [BUS_LEG], rank: 0, walkMinutes: [5, 6] },
		],
		schedule: {
			days: [1, 3, 5],
			includeHolidays: true,
			leadMinutes: 10,
			leaveMinute: 5,
			timezone: "Asia/Seoul",
		},
	};
	return {
		id: "place-gym",
		kind: "other",
		name: "헬스장",
		plan,
		sync: "synced",
		updatedAt: 1,
	};
}

it("is empty before it starts", () => {
	expect(createSetupDraft().get()).toBeNull();
});

it("starts a new place with the defaults", () => {
	const draft = createSetupDraft();
	draft.start(null, IDS);
	expect(draft.get()).toEqual({
		days: [1, 2, 3, 4, 5],
		includeHolidays: false,
		kind: "work",
		leaveMinute: 490,
		name: "",
		placeId: "place-new",
		planId: "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59",
		routes: [emptyRoute()],
	});
});

it("starts from an existing place with its values and the primary route first", () => {
	const draft = createSetupDraft();
	draft.start(existingPlace(), IDS);
	expect(draft.get()).toEqual({
		days: [1, 3, 5],
		includeHolidays: true,
		kind: "other",
		leaveMinute: 5,
		name: "헬스장",
		placeId: "place-gym",
		planId: "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b",
		routes: [
			{ legs: [BUS_LEG], walkMinutes: [5, 6] },
			{ legs: [SUBWAY_LEG], walkMinutes: [7, 4] },
		],
	});
});

it("merges a patch with update", () => {
	const draft = createSetupDraft();
	draft.start(null, IDS);
	draft.update({ kind: "other", name: "헬스장" });
	draft.update({ leaveMinute: 1439 });
	expect(draft.get()?.kind).toBe("other");
	expect(draft.get()?.name).toBe("헬스장");
	expect(draft.get()?.leaveMinute).toBe(1439);
	expect(draft.get()?.days).toEqual([1, 2, 3, 4, 5]);
});

it("replaces a route and appends one at the end with setRoute", () => {
	const draft = createSetupDraft();
	draft.start(null, IDS);
	const primary = addLeg(emptyRoute(), BUS_LEG);
	draft.setRoute(0, primary);
	expect(draft.get()?.routes).toEqual([primary]);
	const alternative = addLeg(emptyRoute(), SUBWAY_LEG);
	draft.setRoute(1, alternative);
	expect(draft.get()?.routes).toEqual([primary, alternative]);
});

it("ignores setRoute past the end so no empty route is left in between", () => {
	const draft = createSetupDraft();
	draft.start(null, IDS);
	draft.setRoute(3, addLeg(emptyRoute(), BUS_LEG));
	expect(draft.get()?.routes).toEqual([emptyRoute()]);
	draft.setRoute(-1, addLeg(emptyRoute(), BUS_LEG));
	expect(draft.get()?.routes).toEqual([emptyRoute()]);
});

it("does nothing on update or setRoute before it starts", () => {
	const draft = createSetupDraft();
	draft.update({ name: "회사" });
	draft.setRoute(0, addLeg(emptyRoute(), BUS_LEG));
	expect(draft.get()).toBeNull();
});

it("is empty again after clear", () => {
	const draft = createSetupDraft();
	draft.start(null, IDS);
	draft.clear();
	expect(draft.get()).toBeNull();
});

it("tells subscribers about each change until they unsubscribe", () => {
	const draft = createSetupDraft();
	let calls = 0;
	const unsubscribe = draft.subscribe(() => {
		calls += 1;
	});
	draft.start(null, IDS);
	draft.update({ name: "a" });
	draft.setRoute(0, addLeg(emptyRoute(), BUS_LEG));
	draft.clear();
	expect(calls).toBe(4);
	unsubscribe();
	draft.start(null, IDS);
	expect(calls).toBe(4);
});

it("returns the same value between changes so React can subscribe to it", () => {
	const draft = createSetupDraft();
	draft.start(null, IDS);
	expect(draft.get()).toBe(draft.get());
});

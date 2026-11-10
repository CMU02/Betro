import { expect, it } from "bun:test";

import { parseContentState, shouldApply } from "./content-state";

const SAMPLE = {
	delayMinutes: 0,
	destinationEtaEpoch: 1_700_002_400,
	etaEpoch: 1_700_000_480,
	etaState: "live",
	leaveEpoch: null,
	legCount: 1,
	legIndex: 0,
	lineName: "146",
	mode: "bus",
	passed: null,
	positionState: "live",
	sentAt: 1_700_000_000,
	seq: 3,
	stage: "wait",
	stopName: "강남역",
	stopsAway: 2,
	suggestion: null,
	v: 1,
};

function parsed() {
	const state = parseContentState(SAMPLE);
	if (!state) {
		throw new Error("sample must parse");
	}
	return state;
}

it("parses the sample payload", () => {
	expect(parsed()).toEqual(SAMPLE as ReturnType<typeof parsed>);
});

it("keeps passed and suggestion objects", () => {
	const state = parseContentState({
		...SAMPLE,
		passed: { lineName: "146" },
		suggestion: {
			boardEtaEpoch: 5,
			lineName: "440",
			rank: 1,
			savesMinutes: 6,
		},
	});
	expect(state?.passed).toEqual({ lineName: "146" });
	expect(state?.suggestion?.savesMinutes).toBe(6);
});

it("rejects a different version, unknown stage and string seq", () => {
	expect(parseContentState({ ...SAMPLE, v: 2 })).toBeNull();
	expect(parseContentState({ ...SAMPLE, stage: "fly" })).toBeNull();
	expect(parseContentState({ ...SAMPLE, seq: "3" })).toBeNull();
	expect(parseContentState({ ...SAMPLE, stopsAway: "2" })).toBeNull();
	expect(parseContentState({ ...SAMPLE, passed: { lineName: 1 } })).toBeNull();
	expect(parseContentState(null)).toBeNull();
	expect(parseContentState("text")).toBeNull();
});

it("ignores unknown fields", () => {
	const state = parseContentState({ ...SAMPLE, future: "x" });
	expect(state).not.toBeNull();
	expect(state).not.toHaveProperty("future");
});

it("applies the first value", () => {
	expect(shouldApply(null, parsed())).toBe(true);
});

it("drops same and older seq, applies newer", () => {
	expect(shouldApply({ ended: false, seq: 3 }, parsed())).toBe(false);
	expect(shouldApply({ ended: false, seq: 4 }, parsed())).toBe(false);
	expect(shouldApply({ ended: false, seq: 2 }, parsed())).toBe(true);
});

it("drops everything for an ended session", () => {
	expect(shouldApply({ ended: true, seq: 1 }, parsed())).toBe(false);
});

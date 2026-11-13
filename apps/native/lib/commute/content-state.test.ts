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

const NEXT_LEGS = [
	{
		boardEtaEpoch: 1_700_002_160,
		etaState: "estimated",
		lineName: "2호선",
		mode: "subway",
		stopName: "잠실역",
	},
	{
		boardEtaEpoch: null,
		etaState: "live",
		lineName: "341",
		mode: "bus",
		stopName: "잠실역.롯데월드",
	},
];

it("parses the sample payload", () => {
	expect(parsed()).toEqual({
		...SAMPLE,
		nextLegs: [],
	} as ReturnType<typeof parsed>);
});

it("reads a v1 payload without nextLegs as no remaining legs", () => {
	expect(SAMPLE).not.toHaveProperty("nextLegs");
	expect(parseContentState(SAMPLE)?.nextLegs).toEqual([]);
});

it("keeps two valid remaining legs as they are", () => {
	expect(
		parseContentState({ ...SAMPLE, nextLegs: NEXT_LEGS })?.nextLegs
	).toEqual(NEXT_LEGS as ReturnType<typeof parsed>["nextLegs"]);
});

it("rejects the whole value when a remaining leg is malformed", () => {
	const [first, second] = NEXT_LEGS;
	const { stopName: _dropped, ...withoutStop } = second;
	expect(
		parseContentState({ ...SAMPLE, nextLegs: [first, withoutStop] })
	).toBeNull();
	expect(
		parseContentState({ ...SAMPLE, nextLegs: [{ ...first, mode: "tram" }] })
	).toBeNull();
	expect(
		parseContentState({
			...SAMPLE,
			nextLegs: [{ ...first, boardEtaEpoch: "08:36" }],
		})
	).toBeNull();
	expect(parseContentState({ ...SAMPLE, nextLegs: "x" })).toBeNull();
});

it("keeps passed and suggestion objects", () => {
	const state = parseContentState({
		...SAMPLE,
		passed: { lineName: "146" },
		suggestion: {
			boardEtaEpoch: 5,
			lineName: "440",
			mode: "bus",
			rank: 1,
			savesMinutes: 6,
		},
	});
	expect(state?.passed).toEqual({ lineName: "146" });
	expect(state?.suggestion?.savesMinutes).toBe(6);
	expect(state?.suggestion?.mode).toBe("bus");
});

it("rejects a suggestion without a valid mode", () => {
	const suggestion = {
		boardEtaEpoch: 5,
		lineName: "440",
		rank: 1,
		savesMinutes: 6,
	};
	expect(parseContentState({ ...SAMPLE, suggestion })).toBeNull();
	expect(
		parseContentState({
			...SAMPLE,
			suggestion: { ...suggestion, mode: "tram" },
		})
	).toBeNull();
	expect(
		parseContentState({
			...SAMPLE,
			suggestion: { ...suggestion, mode: "subway" },
		})?.suggestion?.mode
	).toBe("subway");
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

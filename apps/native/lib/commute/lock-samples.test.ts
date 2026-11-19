import { expect, it } from "bun:test";

import fixture from "./__fixtures__/lock-screen-cases.json";
import type { ContentState } from "./content-state";
import { lockSampleState, lockSamples } from "./lock-samples";

const NOW = 1_800_000_000;

it("lists every fixture case in order", () => {
	const samples = lockSamples();
	expect(samples.map((sample) => sample.name)).toEqual(
		fixture.cases.map((item) => item.name)
	);
	expect(samples[0]?.status).toBe(fixture.cases[0]?.expected.status);
});

it("shifts every epoch by the distance from the case clock to now", () => {
	const sample = lockSamples().find(
		(item) => item.name === "three remaining legs show two and the rest count"
	);
	if (!sample) {
		throw new Error("fixture case is missing");
	}
	const offset = NOW - sample.now;
	const shifted = lockSampleState(sample, NOW);
	const { state } = sample;
	expect(shifted.sentAt).toBe(state.sentAt + offset);
	expect(shifted.etaEpoch).toBe((state.etaEpoch ?? 0) + offset);
	expect(shifted.destinationEtaEpoch).toBe(
		(state.destinationEtaEpoch ?? 0) + offset
	);
	expect(shifted.nextLegs.map((leg) => leg.boardEtaEpoch)).toEqual(
		state.nextLegs.map((leg) =>
			leg.boardEtaEpoch === null ? null : leg.boardEtaEpoch + offset
		)
	);
	expect(shifted.seq).toBe(state.seq);
});

it("keeps null epochs null and shifts leave and suggestion times", () => {
	const [base] = lockSamples();
	if (!base) {
		throw new Error("fixture has no cases");
	}
	const state: ContentState = {
		...base.state,
		etaEpoch: null,
		leaveEpoch: base.now + 300,
		suggestion: {
			boardEtaEpoch: base.now + 180,
			lineName: "440",
			mode: "bus",
			rank: 1,
			savesMinutes: 6,
		},
	};
	const shifted = lockSampleState({ ...base, state }, NOW);
	expect(shifted.etaEpoch).toBeNull();
	expect(shifted.leaveEpoch).toBe(NOW + 300);
	expect(shifted.suggestion?.boardEtaEpoch).toBe(NOW + 180);
	expect(base.state.etaEpoch).not.toBeNull();
});

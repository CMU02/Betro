import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import fixture from "./__fixtures__/lock-screen-cases.json";
import type { ContentState } from "./content-state";
import { type LockScreenDeps, lockScreenModel } from "./lock-screen-model";

const FORBIDDEN_TEXT = /\bnull\b|undefined|NaN|1970/;
const NOW = 1_794_265_200; // 2026-11-10 08:00 KST

interface Case {
	expected: {
		actions: string[];
		detail: string;
		minutes: string | null;
		status: string;
		suggestion: string | null;
		tag: string;
	};
	header?: string;
	name: string;
	now: number;
	platform?: "ios" | "android";
	state: ContentState;
}

interface Fixture {
	cases: Case[];
	timezone: string;
}

const { cases, timezone } = fixture as Fixture;

/** 모델 결과에 든 모든 문자열 */
function stringsOf(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.flatMap(stringsOf);
	}
	if (value !== null && typeof value === "object") {
		return Object.values(value).flatMap(stringsOf);
	}
	return [];
}

function deps(overrides: Partial<LockScreenDeps> = {}): LockScreenDeps {
	return {
		header: null,
		now: NOW,
		platform: "ios",
		t,
		timezone,
		...overrides,
	};
}

const BASE = (cases[4] as Case).state;

function state(overrides: Partial<ContentState>): ContentState {
	return { ...BASE, ...overrides };
}

for (const item of cases) {
	it(`matches fixture: ${item.name}`, () => {
		const model = lockScreenModel(
			item.state,
			deps({
				header: item.header ?? null,
				now: item.now,
				platform: item.platform ?? "ios",
			})
		);
		expect(model.status).toBe(item.expected.status);
		expect(model.detail).toBe(item.expected.detail);
		expect(model.minutes).toBe(item.expected.minutes);
		expect(model.tag).toBe(item.expected.tag);
		expect(model.suggestion).toBe(item.expected.suggestion);
		expect(model.actions).toEqual(item.expected.actions as never);
		if (item.header) {
			expect(model.header).toBe(item.header);
		}
		for (const text of stringsOf(model)) {
			expect(text).not.toMatch(FORBIDDEN_TEXT);
		}
	});
}

it("fixture now matches the test clock", () => {
	expect((cases[0] as Case).now).toBe(NOW);
	expect(timezone).toBe("Asia/Seoul");
});

it("never prints null, undefined, NaN or 1970 for empty values", () => {
	const empty = state({
		destinationEtaEpoch: null,
		etaEpoch: null,
		leaveEpoch: null,
		stopsAway: null,
		suggestion: null,
	});
	const model = lockScreenModel(empty, deps());
	expect(model.status).toBe("위치 확인 중");
	expect(model.detail).toBe("강남역");
	expect(model.minutes).toBeNull();
	expect(model.suggestion).toBeNull();
	for (const text of stringsOf(model)) {
		expect(text).not.toMatch(FORBIDDEN_TEXT);
	}
});

it("remaining minutes: 61s, 59s and past", () => {
	expect(lockScreenModel(state({ etaEpoch: NOW + 61 }), deps()).minutes).toBe(
		"1분"
	);
	expect(lockScreenModel(state({ etaEpoch: NOW + 59 }), deps()).minutes).toBe(
		"곧"
	);
	expect(lockScreenModel(state({ etaEpoch: NOW - 300 }), deps()).minutes).toBe(
		"곧"
	);
});

it("tags", () => {
	expect(lockScreenModel(state({ etaState: "estimated" }), deps()).tag).toBe(
		"estimated"
	);
	expect(lockScreenModel(state({ delayMinutes: 5 }), deps()).tag).toBe(
		"delayed"
	);
	expect(lockScreenModel(state({ delayMinutes: 4 }), deps()).tag).toBe("live");
	const stale = lockScreenModel(
		state({ etaState: "live", positionState: "stale" }),
		deps()
	);
	expect(stale.tag).toBe("estimated");
	expect(stale.tagLabel).toBe("시간표 추정");
});

it("actions per platform and stage", () => {
	expect(lockScreenModel(state({ stage: "walk" }), deps()).actions).toEqual([
		"boarded",
		"next",
	]);
	expect(lockScreenModel(state({ stage: "ride" }), deps()).actions).toEqual([]);
	expect(
		lockScreenModel(state({ stage: "wait" }), deps({ platform: "android" }))
			.actions
	).toEqual(["boarded", "next", "end"]);
	expect(
		lockScreenModel(state({ stage: "ride" }), deps({ platform: "android" }))
			.actions
	).toEqual(["end"]);
});

it("progress nodes grow with leg count", () => {
	expect(lockScreenModel(state({ legCount: 1 }), deps()).progress.nodes).toBe(
		4
	);
	expect(lockScreenModel(state({ legCount: 3 }), deps()).progress.nodes).toBe(
		8
	);
	const second = lockScreenModel(
		state({ legCount: 3, legIndex: 1, stage: "wait" }),
		deps()
	);
	expect(second.progress.current).toBe(3);
	expect(
		lockScreenModel(state({ legCount: 3, legIndex: 1, stage: "walk" }), deps())
			.progress.current
	).toBe(2);
	expect(
		lockScreenModel(state({ legCount: 3, legIndex: 1, stage: "ride" }), deps())
			.progress.current
	).toBe(3.5);
	expect(
		lockScreenModel(state({ legCount: 3, stage: "arrived" }), deps()).progress
			.current
	).toBe(7);
});

it("uses the fallback header when none is stored", () => {
	expect(lockScreenModel(state({}), deps({ header: null })).header).toBe(
		"출퇴근"
	);
});

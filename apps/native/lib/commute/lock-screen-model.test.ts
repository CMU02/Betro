import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import fixture from "./__fixtures__/lock-screen-cases.json";
import type { ContentState } from "./content-state";
import { type LockScreenDeps, lockScreenModel } from "./lock-screen-model";

const FORBIDDEN_TEXT = /\bnull\b|undefined|NaN|1970/;
const NOW = 1_794_265_200; // 2026-11-10 08:00 KST

interface Case {
	expected: {
		detail: string;
		minutes: string | null;
		moreLegs: string | null;
		nextLegs: { lineName: string; mode: "bus" | "subway"; text: string }[];
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
		expect(model.nextLegs).toEqual(item.expected.nextLegs);
		expect(model.moreLegs).toBe(item.expected.moreLegs);
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

const STAGES = ["walk", "wait", "ride", "arrived", "ended"] as const;

it("actions: iOS has none and Android has only end, at every stage", () => {
	for (const stage of STAGES) {
		expect(lockScreenModel(state({ stage }), deps()).actions).toEqual([]);
		expect(
			lockScreenModel(state({ stage }), deps({ platform: "android" })).actions
		).toEqual(["end"]);
	}
});

const JAMSIL_0836 = NOW + 36 * 60;
const SUBWAY_LEG = {
	boardEtaEpoch: JAMSIL_0836,
	etaState: "live",
	lineName: "2호선",
	mode: "subway",
	stopName: "잠실역",
} as const;

it("one remaining leg is one line without the rest count", () => {
	const model = lockScreenModel(
		state({ legCount: 2, legIndex: 0, nextLegs: [SUBWAY_LEG] }),
		deps()
	);
	expect(model.nextLegs).toEqual([
		{ lineName: "2호선", mode: "subway", text: "잠실역 · 08:36 승차" },
	]);
	expect(model.moreLegs).toBeNull();
});

it("three remaining legs are two lines and the rest count", () => {
	const model = lockScreenModel(
		state({
			legCount: 4,
			legIndex: 0,
			nextLegs: [
				SUBWAY_LEG,
				{
					...SUBWAY_LEG,
					lineName: "341",
					mode: "bus",
					stopName: "잠실역.롯데월드",
				},
				{ ...SUBWAY_LEG, lineName: "3412", mode: "bus", stopName: "강동구청" },
			],
		}),
		deps()
	);
	expect(model.nextLegs.map((leg) => leg.lineName)).toEqual(["2호선", "341"]);
	expect(model.moreLegs).toBe("외 1구간");
});

it("an estimated remaining leg says about", () => {
	const model = lockScreenModel(
		state({ nextLegs: [{ ...SUBWAY_LEG, etaState: "estimated" }] }),
		deps()
	);
	expect(model.nextLegs[0]?.text).toBe("잠실역 · 약 08:36 승차");
});

it("a remaining leg without a time shows the stop only", () => {
	const model = lockScreenModel(
		state({
			nextLegs: [{ ...SUBWAY_LEG, boardEtaEpoch: null, etaState: "estimated" }],
		}),
		deps()
	);
	expect(model.nextLegs[0]?.text).toBe("잠실역");
});

it("no remaining legs is no lines", () => {
	const model = lockScreenModel(state({ nextLegs: [] }), deps());
	expect(model.nextLegs).toEqual([]);
	expect(model.moreLegs).toBeNull();
});

it("before leave says when to go and when to board", () => {
	const model = lockScreenModel(
		state({
			etaEpoch: NOW + 15 * 60,
			leaveEpoch: NOW + 10 * 60,
			legIndex: 0,
			stage: "walk",
			stopName: "천호역.현대백화점",
		}),
		deps()
	);
	expect(model.status).toBe("08:10에 나가세요");
	expect(model.detail).toBe("천호역.현대백화점 · 08:15 탑승");
});

it("has no progress field", () => {
	expect(lockScreenModel(state({}), deps())).not.toHaveProperty("progress");
});

it("uses the fallback header when none is stored", () => {
	expect(lockScreenModel(state({}), deps({ header: null })).header).toBe(
		"출퇴근"
	);
});

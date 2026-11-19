import { describe, expect, test } from "bun:test";
import type { MarginSample } from "./margin";
import {
	earliestLivePrediction,
	LEAVE_MARGIN_LEAD_WINDOW_MIN,
	LEAVE_MARGIN_MIN_SAMPLES,
	LEAVE_MARGIN_MIN_SEC,
	leaveMargins,
	marginOf,
} from "./margin";
import type { LineRef } from "./refs";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 2026-11-10(화) 08:00 KST. */
const BASE = Date.UTC(2026, 10, 9, 23, 0);
const MAX_SEC = 300;
const LINE2: LineRef = "seoul-subway:line2";
const LINE7: LineRef = "seoul-subway:line7";

/** 08:mm:ss */
function at(minute: number, second = 0): number {
	return BASE + minute * MINUTE_MS + second * SECOND_MS;
}

/** 1초, 2초, … n초 오차(밀리초). */
function secondsUpTo(n: number): number[] {
	return Array.from({ length: n }, (_, i) => (i + 1) * SECOND_MS);
}

function repeat(sec: number, n: number): number[] {
	return Array.from({ length: n }, () => sec * SECOND_MS);
}

/** 도착(low) 08:20, 08:10에 낸 live 예측 하나. 오차는 `errorSec`. */
function subwaySample(line: LineRef, errorSec: number): MarginSample {
	const low = at(20);
	return {
		high: low + 45 * SECOND_MS,
		line,
		low,
		mode: "subway",
		predictions: [
			{ at: at(10), etaAt: low + errorSec * SECOND_MS, live: true },
		],
	};
}

test("상수: 예측 창 5~15분, 표본 100건, 최소 여유 30초", () => {
	expect(LEAVE_MARGIN_LEAD_WINDOW_MIN).toEqual([5, 15]);
	expect(LEAVE_MARGIN_MIN_SAMPLES).toBe(100);
	expect(LEAVE_MARGIN_MIN_SEC).toBe(30);
});

describe("earliestLivePrediction", () => {
	test("도착 5~15분 전 live 예측 중 가장 이른 것(창 밖·live 아님은 뺀다)", () => {
		const sample: MarginSample = {
			high: at(21),
			line: LINE2,
			low: at(20),
			mode: "subway",
			predictions: [
				{ at: at(12), etaAt: at(19, 30), live: false },
				{ at: at(8), etaAt: at(19, 50), live: true },
				{ at: at(4), etaAt: at(19), live: true },
				{ at: at(6), etaAt: at(19, 40), live: true },
			],
		};
		expect(earliestLivePrediction(sample)).toEqual({
			at: at(6),
			etaAt: at(19, 40),
		});
	});

	test("창 안에 live 예측이 없으면 null", () => {
		const sample: MarginSample = {
			high: at(21),
			line: LINE2,
			low: at(20),
			mode: "subway",
			predictions: [
				{ at: at(4), etaAt: at(19), live: true },
				{ at: at(12), etaAt: at(19, 30), live: false },
				{ at: at(18), etaAt: at(19, 50), live: true },
			],
		};
		expect(earliestLivePrediction(sample)).toBeNull();
	});

	test("창 경계(정확히 15분 전, 5분 전)는 창 안이다", () => {
		const sample: MarginSample = {
			high: at(21),
			line: LINE2,
			low: at(20),
			mode: "subway",
			predictions: [{ at: at(5), etaAt: at(19), live: true }],
		};
		expect(earliestLivePrediction(sample)).toEqual({
			at: at(5),
			etaAt: at(19),
		});
		expect(
			earliestLivePrediction({
				...sample,
				predictions: [{ at: at(15), etaAt: at(19), live: true }],
			})
		).toEqual({ at: at(15), etaAt: at(19) });
	});

	test("창을 바꿔 줄 수 있다(실험 6 확인용 [4, 6]분)", () => {
		const sample: MarginSample = {
			high: at(21),
			line: LINE2,
			low: at(20),
			mode: "subway",
			predictions: [
				{ at: at(6), etaAt: at(19), live: true },
				{ at: at(15), etaAt: at(19, 30), live: true },
			],
		};
		expect(earliestLivePrediction(sample, [4, 6])).toEqual({
			at: at(15),
			etaAt: at(19, 30),
		});
	});
});

describe("marginOf", () => {
	test("1초~100초 100개 → nearest-rank 95번째 백분위수 95초", () => {
		expect(marginOf(secondsUpTo(100), MAX_SEC)).toEqual({
			capped: false,
			marginSec: 95,
			n: 100,
			p95Sec: 95,
		});
	});

	test("99개면 표본이 모자라 값을 내지 않는다", () => {
		expect(marginOf(secondsUpTo(99), MAX_SEC)).toEqual({
			capped: false,
			marginSec: null,
			n: 99,
			p95Sec: null,
		});
	});

	test("모두 10초면 최소값 30초를 쓴다(원래 p95는 그대로 남긴다)", () => {
		expect(marginOf(repeat(10, 100), MAX_SEC)).toEqual({
			capped: false,
			marginSec: 30,
			n: 100,
			p95Sec: 10,
		});
	});

	test("모두 400초면 상한 300초로 자르고 capped", () => {
		expect(marginOf(repeat(400, 100), MAX_SEC)).toEqual({
			capped: true,
			marginSec: 300,
			n: 100,
			p95Sec: 400,
		});
	});

	test("오차는 부호를 그대로 본다(예측보다 늦게 온 −는 여유를 키우지 않는다)", () => {
		const errors = [...repeat(-200, 94), ...repeat(20, 6)];
		expect(marginOf(errors, MAX_SEC)).toEqual({
			capped: false,
			marginSec: 30,
			n: 100,
			p95Sec: 20,
		});
	});

	test("초 단위로 올림한다", () => {
		const errors = Array.from({ length: 100 }, () => 40_200);
		expect(marginOf(errors, MAX_SEC).p95Sec).toBe(41);
	});
});

describe("leaveMargins", () => {
	test("지하철 2호선 100개·7호선 20개 → 수단은 120개, 노선은 2호선만 값", () => {
		const samples = [
			...Array.from({ length: 100 }, (_, i) => subwaySample(LINE2, i + 1)),
			...Array.from({ length: 20 }, () => subwaySample(LINE7, 50)),
		];
		const result = leaveMargins(samples, MAX_SEC);
		expect(result.mode.subway.n).toBe(120);
		expect(result.mode.subway.marginSec).not.toBeNull();
		expect(result.byLine[LINE2]?.marginSec).not.toBeNull();
		expect(result.byLine[LINE7]?.marginSec).toBeNull();
		expect(result.byLine[LINE7]?.n).toBe(20);
		expect(result.mode.bus).toEqual({
			capped: false,
			marginSec: null,
			n: 0,
			p95Sec: null,
		});
	});

	test("창 안에 live 예측이 없는 도착은 표본에서 뺀다", () => {
		const usable = subwaySample(LINE2, 30);
		const unusable: MarginSample = {
			...usable,
			predictions: [{ at: at(18), etaAt: at(20), live: true }],
		};
		const result = leaveMargins([usable, unusable], MAX_SEC);
		expect(result.mode.subway.n).toBe(1);
		expect(result.byLine[LINE2]?.n).toBe(1);
	});
});

import type { LineRef } from "./refs";

/**
 * 여유 폭 사전 수집(스펙 4.3). 수집기 기록에서 뽑은 도착마다 "도착 5~15분 전 첫 실시간 예측"의
 * 오차(`etaAt − low`)를 모아 95번째 백분위수(nearest-rank)를 여유 폭으로 쓴다.
 * 여유 폭은 차량 오차만 덮는다. 도보 오차는 이 계산에 없다.
 */

/** 예측 시점 창: 도착(low) 몇 분 전부터 몇 분 전까지의 예측을 보는가. */
export const LEAVE_MARGIN_LEAD_WINDOW_MIN = [5, 15] as const;
/** 수단·노선마다 이만큼 도착이 있어야 값을 낸다. */
export const LEAVE_MARGIN_MIN_SAMPLES = 100;
/** 측정 구간 폭보다 작은 여유는 믿을 수 없어 이 값 아래로 내리지 않는다. */
export const LEAVE_MARGIN_MIN_SEC = 30;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const PERCENTILE = 0.95;

export type LeadWindowMin = readonly [number, number];

/** 실제 도착 하나와 그 차량에 대해 나온 예측들. */
export interface MarginSample {
	/** 실제 도착 구간의 늦은 쪽, 밀리초. */
	high: number;
	line: LineRef;
	/** 실제 도착 구간의 이른 쪽, 밀리초. 오차와 예측 창의 기준이다. */
	low: number;
	mode: "bus" | "subway";
	/** `at`은 예측을 받은 시각, `live`는 실시간 예측인가(시간표 추정이 아닌가). */
	predictions: { at: number; etaAt: number; live: boolean }[];
}

/**
 * `p95Sec`는 상한·최소값을 적용하기 전 원래 값이다. 표본이 모자라면 `p95Sec`·`marginSec`이 null.
 * `capped`는 상한이 값을 실제로 깎았는가.
 */
export interface MarginResult {
	capped: boolean;
	marginSec: number | null;
	n: number;
	p95Sec: number | null;
}

/** 도착(low) 5~15분 전 live 예측 중 가장 이른 것. 창 양끝은 창 안이다. */
export function earliestLivePrediction(
	sample: MarginSample,
	windowMin: LeadWindowMin = LEAVE_MARGIN_LEAD_WINDOW_MIN
): { at: number; etaAt: number } | null {
	const [nearMin, farMin] = windowMin;
	const from = sample.low - farMin * MINUTE_MS;
	const to = sample.low - nearMin * MINUTE_MS;
	let earliest: { at: number; etaAt: number } | null = null;
	for (const prediction of sample.predictions) {
		const inWindow = prediction.at >= from && prediction.at <= to;
		if (!(prediction.live && inWindow)) {
			continue;
		}
		if (earliest === null || prediction.at < earliest.at) {
			earliest = { at: prediction.at, etaAt: prediction.etaAt };
		}
	}
	return earliest;
}

/** nearest-rank 백분위수: 오름차순 `ceil(p·n)`번째 값. */
function nearestRank(sorted: number[], percentile: number): number {
	const rank = Math.ceil(percentile * sorted.length);
	return sorted[Math.max(rank, 1) - 1] as number;
}

/**
 * 오차(밀리초, `etaAt − low`) → 여유 폭. 부호를 그대로 본다. +는 차가 예측보다 일찍 온 쪽이다.
 * 초로 올림하고, 최소 30초, 상한 `maxSec`를 적용한다.
 */
export function marginOf(errorsMs: number[], maxSec: number): MarginResult {
	const n = errorsMs.length;
	if (n < LEAVE_MARGIN_MIN_SAMPLES) {
		return { capped: false, marginSec: null, n, p95Sec: null };
	}
	const sorted = [...errorsMs].sort((a, b) => a - b);
	const p95Sec = Math.ceil(nearestRank(sorted, PERCENTILE) / SECOND_MS);
	const floored = Math.max(p95Sec, LEAVE_MARGIN_MIN_SEC);
	const marginSec = Math.min(floored, maxSec);
	return { capped: marginSec < floored, marginSec, n, p95Sec };
}

/**
 * 표본 → 수단별·노선별 여유 폭. 창 안에 live 예측이 없는 도착은 뺀다.
 * 노선별 값은 표본이 모자라도 `n`을 보이려고 항목을 남긴다(`marginSec: null`).
 */
export function leaveMargins(
	samples: MarginSample[],
	maxSec: number,
	windowMin: LeadWindowMin = LEAVE_MARGIN_LEAD_WINDOW_MIN
): {
	mode: Record<"bus" | "subway", MarginResult>;
	byLine: Record<string, MarginResult>;
} {
	const byMode: Record<"bus" | "subway", number[]> = { bus: [], subway: [] };
	const byLine = new Map<string, number[]>();
	for (const sample of samples) {
		const prediction = earliestLivePrediction(sample, windowMin);
		if (prediction === null) {
			continue;
		}
		const error = prediction.etaAt - sample.low;
		byMode[sample.mode].push(error);
		const lineErrors = byLine.get(sample.line) ?? [];
		lineErrors.push(error);
		byLine.set(sample.line, lineErrors);
	}
	const lines: Record<string, MarginResult> = {};
	for (const [line, errors] of byLine) {
		lines[line] = marginOf(errors, maxSec);
	}
	return {
		byLine: lines,
		mode: {
			bus: marginOf(byMode.bus, maxSec),
			subway: marginOf(byMode.subway, maxSec),
		},
	};
}

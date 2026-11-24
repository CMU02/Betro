import { describe, expect, test } from "bun:test";
import {
	dailyReport,
	type SessionSummary,
} from "../packages/commute/src/accuracy";
import { formatReport, hitRates, periodReport } from "./accuracy-report";

const MINUTE_MS = 60_000;

type Prediction = SessionSummary["predictions"][number];

/** 오차(분)만 다른 예측 한 건. */
function prediction(
	errorMin: number,
	line: Prediction["line"] = "seoul-bus:100100"
): Prediction {
	return {
		errorMs: errorMin * MINUTE_MS,
		halfWidthMs: 30_000,
		leadMs: 5 * MINUTE_MS,
		line,
		method: "official",
		stop: line.startsWith("seoul-subway")
			? "seoul-subway:1001"
			: "seoul-bus:200",
	};
}

function summary(
	sessionId: string,
	overrides: Partial<SessionSummary> = {}
): SessionSummary {
	return {
		endReason: "arrived",
		maxSendGapMs: 30_000,
		planId: "plan",
		predictions: [],
		sessionId,
		startDelayMs: 0,
		suggestions: [],
		...overrides,
	};
}

describe("hitRates", () => {
	test("예측 오차 0.5분·1.5분·3분 세 건이면 ±1분 1건(1/3), ±2분 2건(2/3)이다", () => {
		const rates = hitRates([
			summary("a", {
				predictions: [prediction(0.5), prediction(-1.5), prediction(3)],
			}),
		]);
		expect(rates).toHaveLength(1);
		expect(rates[0]).toMatchObject({
			mode: "bus",
			samples: 3,
			within1Min: 1,
			within2Min: 2,
		});
		expect(rates[0]?.ratio1Min).toBeCloseTo(1 / 3);
		expect(rates[0]?.ratio2Min).toBeCloseTo(2 / 3);
	});

	test("예측이 없는 세션은 도착 정확도에 세지 않는다", () => {
		expect(hitRates([summary("a"), summary("b")])).toEqual([]);
	});

	test("지하철 노선 예측은 subway, 버스 출처는 bus로 나눈다", () => {
		const rates = hitRates([
			summary("a", {
				predictions: [
					prediction(0),
					prediction(0.2, "gbis:77"),
					prediction(1, "seoul-subway:1001"),
				],
			}),
		]);
		const byMode = Object.fromEntries(rates.map((rate) => [rate.mode, rate]));
		expect(byMode.bus?.samples).toBe(2);
		expect(byMode.subway?.samples).toBe(1);
		expect(byMode.subway?.within1Min).toBe(1);
	});
});

describe("periodReport", () => {
	test("기간 보고는 자동 시작·끊김·대안 제안을 dailyReport와 같게 센다", () => {
		const summaries = [
			summary("a", {
				maxSendGapMs: 150_000,
				suggestions: [
					{ gainMs: 60_000, verdict: "faster" },
					{ gainMs: -60_000, verdict: "slower" },
				],
			}),
			summary("b", { startDelayMs: 5 * MINUTE_MS }),
		];
		const report = periodReport(summaries);
		const daily = dailyReport(report.date, summaries);
		expect(report).toEqual(daily);
		expect(report.starts).toEqual({ late: 1, onTime: 1, unknown: 0 });
		expect(report.maxSendGapMs).toBe(150_000);
		expect(report.suggestions.faster).toBe(1);
	});
});

describe("formatReport", () => {
	test("기준마다 통과 여부를 찍고 표본이 없어도 던지지 않는다", () => {
		expect(formatReport([])).toContain("표본 없음");
		const text = formatReport([
			summary("a", { predictions: [prediction(0), prediction(0)] }),
		]);
		expect(text).toContain("통과");
	});
});

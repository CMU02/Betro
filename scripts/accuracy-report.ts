/**
 * 7.1 정확도 보고. R2 `commute/summaries/…`에서 받아 둔 `SessionSummary` JSON 폴더를 읽어
 * 도착 정확도와 나머지 자동 기준의 통과 여부를 표로 찍는다. 네트워크는 쓰지 않는다.
 *
 * 사용: `bun scripts/accuracy-report.ts <폴더>`
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	type DailyCommuteReport,
	dailyReport,
	type SessionSummary,
} from "../packages/commute/src/accuracy";
import { parseRef } from "../packages/commute/src/refs";

const MINUTE_MS = 60_000;
/** `accuracy.ts`의 `WITHIN_60_MS`·`WITHIN_120_MS`와 같은 값. */
const WITHIN_1_MIN_MS = MINUTE_MS;
const WITHIN_2_MIN_MS = 2 * MINUTE_MS;
/** 7.1 기준. */
const TARGET_RATIO_1_MIN = 0.8;
const TARGET_RATIO_2_MIN = 0.95;
const TARGET_START_RATIO = 1;
const MAX_SEND_GAP_MS = 2 * MINUTE_MS;
const TARGET_SUGGESTION_RATIO = 0.8;

/** `within1Min`·`within2Min`은 건수, `ratio1Min`·`ratio2Min`은 0~1 비율이다. */
export interface AccuracyHitRates {
	mode: "bus" | "subway";
	ratio1Min: number;
	ratio2Min: number;
	samples: number;
	within1Min: number;
	within2Min: number;
}

/** 예측은 이미 차량마다 5분 전 시점 하나라 다시 고르지 않고 그대로 센다. */
export function hitRates(
	summaries: readonly SessionSummary[]
): AccuracyHitRates[] {
	const counts = {
		bus: { samples: 0, within1Min: 0, within2Min: 0 },
		subway: { samples: 0, within1Min: 0, within2Min: 0 },
	};
	for (const summary of summaries) {
		for (const item of summary.predictions) {
			const mode =
				parseRef(item.line).source === "seoul-subway" ? "subway" : "bus";
			const error = Math.abs(item.errorMs);
			counts[mode].samples += 1;
			if (error <= WITHIN_1_MIN_MS) {
				counts[mode].within1Min += 1;
			}
			if (error <= WITHIN_2_MIN_MS) {
				counts[mode].within2Min += 1;
			}
		}
	}
	const rates: AccuracyHitRates[] = [];
	for (const mode of ["bus", "subway"] as const) {
		const count = counts[mode];
		if (count.samples === 0) {
			continue;
		}
		rates.push({
			mode,
			ratio1Min: count.within1Min / count.samples,
			ratio2Min: count.within2Min / count.samples,
			samples: count.samples,
			within1Min: count.within1Min,
			within2Min: count.within2Min,
		});
	}
	return rates;
}

/** 7.1의 나머지 자동 기준. 기간 전체 요약을 `dailyReport`로 한 번에 묶은 값이다. */
export function periodReport(
	summaries: readonly SessionSummary[]
): DailyCommuteReport {
	return dailyReport("period", [...summaries]);
}

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const mark = (pass: boolean): string => (pass ? "통과" : "미달");

/** 표와 기준마다 통과 여부. */
export function formatReport(summaries: readonly SessionSummary[]): string {
	const lines: string[] = [`세션 ${summaries.length}건`, ""];
	lines.push("도착 정확도 (5분 전 예측)");
	const rates = hitRates(summaries);
	if (rates.length === 0) {
		lines.push("  표본 없음");
	}
	for (const rate of rates) {
		lines.push(
			`  ${rate.mode}  표본 ${rate.samples}  ±1분 ${rate.within1Min}건 ${pct(rate.ratio1Min)} (${mark(rate.ratio1Min >= TARGET_RATIO_1_MIN)}, 기준 80%)  ±2분 ${rate.within2Min}건 ${pct(rate.ratio2Min)} (${mark(rate.ratio2Min >= TARGET_RATIO_2_MIN)}, 기준 95%)`
		);
	}
	const report = periodReport(summaries);
	const { starts } = report;
	const startTotal = starts.onTime + starts.late + starts.unknown;
	lines.push("", "자동 시작");
	lines.push(
		startTotal === 0
			? "  표본 없음"
			: `  정시 ${starts.onTime}/${startTotal} (${mark(starts.onTime / startTotal >= TARGET_START_RATIO)}, 기준 100%)  늦음 ${starts.late}  알 수 없음 ${starts.unknown}`
	);
	lines.push(
		"",
		"끊김",
		`  최대 전송 간격 ${Math.round(report.maxSendGapMs / 1000)}초 (${mark(report.maxSendGapMs <= MAX_SEND_GAP_MS)}, 기준 2분 이하)`
	);
	const { faster, slower, unknown } = report.suggestions;
	lines.push("", "대안 제안");
	lines.push(
		faster + slower === 0
			? "  표본 없음"
			: `  빠름 ${faster} 느림 ${slower} 알 수 없음 ${unknown}  ${pct(faster / (faster + slower))} (${mark(faster / (faster + slower) >= TARGET_SUGGESTION_RATIO)}, 기준 80%)`
	);
	lines.push("", "나가는 시각 (보고만)", `  ${JSON.stringify(report.leave)}`);
	lines.push("", "종료", `  ${JSON.stringify(report.endReasons)}`);
	return lines.join("\n");
}

function jsonFilesIn(dir: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			files.push(...jsonFilesIn(path));
		} else if (name.endsWith(".json")) {
			files.push(path);
		}
	}
	return files;
}

if (import.meta.main) {
	const [, , dir] = process.argv;
	if (!dir) {
		console.error("사용: bun scripts/accuracy-report.ts <폴더>");
		process.exit(1);
	}
	const summaries = jsonFilesIn(dir).map(
		(path) => JSON.parse(readFileSync(path, "utf8")) as SessionSummary
	);
	console.log(formatReport(summaries));
}

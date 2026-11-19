/**
 * 여유 폭 사전 수집 계산(스펙 4.3, 계획 Task 9).
 *
 *   bun scripts/leave-margin.ts --targets targets.json [--subway-dir <dir>] [--bus-file <ndjson>]
 *     [--max-sec 300] [--lead-window 5,15]
 *
 * - `targets.json`: `[{ "mode": "subway", "line": "seoul-subway:line2",
 *   "stop": "seoul-subway:1002000222", "direction": "up" }, …]`. 버스는
 *   `{ "mode": "bus", "line": "seoul-bus:<routeId>", "stop": "seoul-bus:<stId>", "seq": 39 }`
 *   (`seq`는 선택. 없으면 응답에서 `stId`로 찾는다).
 * - `--subway-dir`: R2 `raw/subway-all/…`, `events/subway/…`를 같은 경로로 내려받은 폴더.
 * - `--bus-file`: 버스 수집 Worker의 `/dump` NDJSON.
 * - `--lead-window`: 예측 시점 창(분). 실험 6과 맞춰 볼 때만 바꾼다(예: `4,6`).
 *
 * 예측의 `at`은 원천 시각이 아니라 수집기가 받은 시각(`fetchedAt`)이다. 세션이 그 예측을 처음
 * 쓸 수 있는 때가 받은 때이기 때문이다(스펙 4.3 "처음 뜬 실시간 예측").
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { commuteConfig } from "../packages/commute/src/config";
import {
	earliestLivePrediction,
	LEAVE_MARGIN_LEAD_WINDOW_MIN,
	type LeadWindowMin,
	leaveMargins,
	type MarginSample,
} from "../packages/commute/src/margin";
import { parseRef } from "../packages/commute/src/refs";
import type { SubwayObservation } from "../packages/realtime/src/observation";
import {
	type BusDropCounts,
	type BusSkipCounts,
	type BusTarget,
	busResponsesOf,
	busSamplesFor,
	isRecord,
	isSubwayArrive,
	parseJson,
	type SubwaySnapshot,
	type SubwayTarget,
	subwaySamplesFor,
	subwaySnapshotOf,
	type Target,
} from "./leave-margin-samples";

const SECOND_MS = 1000;
const DEFAULT_MAX_SEC = 300;
const NDJSON_FILE = /\.ndjson(\.gz)?$/;
const GZIP_FILE = /\.gz$/;
const BACKSLASH = /\\/g;
const RAW_SUBWAY_DIR = "raw/subway-all/";
const EVENTS_SUBWAY_DIR = "events/subway/";

// ── 공통 ────────────────────────────────────────────────────────────

function fail(message: string): never {
	throw new Error(message);
}

function readText(path: string): string {
	const bytes = readFileSync(path);
	return GZIP_FILE.test(path)
		? gunzipSync(bytes).toString("utf8")
		: bytes.toString("utf8");
}

function* jsonLines(path: string): Generator<unknown> {
	for (const line of readText(path).split("\n")) {
		if (line.trim() !== "") {
			yield parseJson(line);
		}
	}
}

/** 폴더 아래 NDJSON 파일 중 `marker`(`raw/subway-all/` 등)가 경로에 든 것. */
function ndjsonFilesUnder(dir: string, marker: string): string[] {
	const entries = readdirSync(dir, { recursive: true, withFileTypes: false });
	const files: string[] = [];
	for (const entry of entries) {
		const relative = String(entry).replace(BACKSLASH, "/");
		if (NDJSON_FILE.test(relative) && `/${relative}`.includes(`/${marker}`)) {
			files.push(join(dir, String(entry)));
		}
	}
	return files;
}

function median(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[mid] as number)
		: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

// ── 대상 ────────────────────────────────────────────────────────────

function targetOf(raw: unknown, index: number): Target {
	if (!isRecord(raw)) {
		return fail(`targets[${index}]: 객체가 아님`);
	}
	const { direction, line, mode, seq, stop } = raw;
	if (typeof line !== "string" || typeof stop !== "string") {
		return fail(`targets[${index}]: line·stop이 문자열이 아님`);
	}
	const lineRef = parseRef(line);
	const stopRef = parseRef(stop);
	if (mode === "subway") {
		if (direction !== "up" && direction !== "down") {
			return fail(`targets[${index}]: 지하철 direction은 up 또는 down`);
		}
		return {
			direction,
			line: `${lineRef.source}:${lineRef.id}`,
			mode,
			statnId: stopRef.id,
		};
	}
	if (mode === "bus") {
		return {
			line: `${lineRef.source}:${lineRef.id}`,
			mode,
			routeId: lineRef.id,
			seq: typeof seq === "number" && Number.isInteger(seq) ? seq : null,
			stId: stopRef.id,
		};
	}
	return fail(`targets[${index}]: mode는 subway 또는 bus`);
}

function readTargets(path: string): Target[] {
	const parsed = parseJson(readText(path));
	if (!Array.isArray(parsed)) {
		return fail(`${path}: 배열이 아님`);
	}
	return parsed.map(targetOf);
}

// ── 지하철 ──────────────────────────────────────────────────────────

function readSubwaySnapshots(
	dir: string,
	statnIds: ReadonlySet<string>
): SubwaySnapshot[] {
	const snapshots: SubwaySnapshot[] = [];
	for (const file of ndjsonFilesUnder(dir, RAW_SUBWAY_DIR)) {
		for (const line of jsonLines(file)) {
			const snapshot = subwaySnapshotOf(line, statnIds);
			if (snapshot) {
				snapshots.push(snapshot);
			}
		}
	}
	// 파일 이름 순서(`08-10` < `08-2`)가 시각 순서가 아니라 받은 시각으로 정렬한다.
	return snapshots.sort((a, b) => a.fetchedAt - b.fetchedAt);
}

function readSubwayArrivals(dir: string): SubwayObservation[] {
	const arrivals: SubwayObservation[] = [];
	for (const file of ndjsonFilesUnder(dir, EVENTS_SUBWAY_DIR)) {
		for (const line of jsonLines(file)) {
			if (isSubwayArrive(line)) {
				arrivals.push(line);
			}
		}
	}
	return arrivals;
}

// ── 버스 ────────────────────────────────────────────────────────────

// ── 출력 ────────────────────────────────────────────────────────────

/** 실험 6과 맞춰 보는 값: 보정 뒤 오차(`etaAt − mid`)와 구간 반폭의 중앙값(초). */
function diagnosticsOf(samples: MarginSample[], windowMin: LeadWindowMin) {
	const errorsMid: number[] = [];
	const halfWidths: number[] = [];
	for (const sample of samples) {
		const prediction = earliestLivePrediction(sample, windowMin);
		if (prediction) {
			const mid = (sample.low + sample.high) / 2;
			errorsMid.push((prediction.etaAt - mid) / SECOND_MS);
			halfWidths.push((sample.high - sample.low) / 2 / SECOND_MS);
		}
	}
	return {
		arrivals: samples.length,
		evaluated: errorsMid.length,
		medianErrorMidSec: median(errorsMid),
		medianHalfWidthSec: median(halfWidths),
	};
}

function leadWindowOf(text: string | undefined): LeadWindowMin {
	if (text === undefined) {
		return LEAVE_MARGIN_LEAD_WINDOW_MIN;
	}
	const [near, far] = text.split(",").map(Number);
	const valid =
		near !== undefined &&
		far !== undefined &&
		Number.isFinite(near) &&
		Number.isFinite(far) &&
		near >= 0 &&
		near < far;
	return valid ? [near, far] : fail(`--lead-window: "${text}"는 "5,15" 꼴`);
}

function maxSecOf(text: string | undefined): number {
	if (text === undefined) {
		return DEFAULT_MAX_SEC;
	}
	const value = Number(text);
	return Number.isFinite(value) && value > 0
		? value
		: fail(`--max-sec: "${text}"는 양수`);
}

function main(): void {
	const { values } = parseArgs({
		options: {
			"bus-file": { type: "string" },
			"lead-window": { type: "string" },
			"max-sec": { type: "string" },
			"subway-dir": { type: "string" },
			targets: { type: "string" },
		},
	});
	const targetsPath = values.targets ?? fail("--targets가 필요합니다");
	const targets = readTargets(targetsPath);
	const maxSec = maxSecOf(values["max-sec"]);
	const windowMin = leadWindowOf(values["lead-window"]);
	const config = commuteConfig(process.env);

	const samples: MarginSample[] = [];
	const subwayTargets = targets.filter(
		(target): target is SubwayTarget => target.mode === "subway"
	);
	const busTargets = targets.filter(
		(target): target is BusTarget => target.mode === "bus"
	);
	const subwayDir = values["subway-dir"];
	if (subwayTargets.length > 0 && subwayDir !== undefined) {
		const statnIds = new Set(subwayTargets.map((target) => target.statnId));
		const snapshots = readSubwaySnapshots(subwayDir, statnIds);
		const arrivals = readSubwayArrivals(subwayDir);
		for (const target of subwayTargets) {
			const biasSec = config.subwayEtaBiasSec[parseRef(target.line).id] ?? 0;
			samples.push(...subwaySamplesFor(target, snapshots, arrivals, biasSec));
		}
	}
	const busFile = values["bus-file"];
	/** 버스 `/dump`에서 뺀 줄, 대상마다 관측으로 쓰지 않은 응답의 이유별 개수. */
	const busInput: {
		droppedLines: BusDropCounts;
		skippedResponses: Record<string, BusSkipCounts>;
	} = { droppedLines: {}, skippedResponses: {} };
	if (busTargets.length > 0 && busFile !== undefined) {
		const { dropped, responses } = busResponsesOf(jsonLines(busFile));
		busInput.droppedLines = dropped;
		for (const target of busTargets) {
			const bus = busSamplesFor(target, responses);
			samples.push(...bus.samples);
			busInput.skippedResponses[`${target.line}|${target.stId}`] = bus.skipped;
		}
	}

	const result = leaveMargins(samples, maxSec, windowMin);
	const byMode = (mode: "bus" | "subway") =>
		samples.filter((sample) => sample.mode === mode);
	// 표본이 모자란 수단은 지금 설정값을 그대로 둔다. 둘 중 하나라도 빠지면 서버가 값 전체를 버린다.
	const modeSec = {
		bus: result.mode.bus.marginSec ?? config.leaveMarginSec.bus,
		subway: result.mode.subway.marginSec ?? config.leaveMarginSec.subway,
	};
	const lineSec: Record<string, number> = {};
	for (const [line, margin] of Object.entries(result.byLine)) {
		if (margin.marginSec !== null) {
			lineSec[line] = margin.marginSec;
		}
	}
	const env = {
		COMMUTE_LEAVE_MARGIN_BY_LINE: JSON.stringify(lineSec),
		COMMUTE_LEAVE_MARGIN_SEC: JSON.stringify(modeSec),
	};
	const report = {
		diagnostics: {
			bus: { ...diagnosticsOf(byMode("bus"), windowMin), ...busInput },
			subway: diagnosticsOf(byMode("subway"), windowMin),
		},
		env,
		leadWindowMin: windowMin,
		maxSec,
		result,
	};

	const lines = [JSON.stringify(report, null, 2), ""];
	const describe = (label: string, margin: (typeof result.mode)["bus"]) =>
		`${label}: n=${margin.n} p95(원래)=${margin.p95Sec ?? "-"}초 여유 폭=${margin.marginSec ?? "-"}초 capped=${margin.capped}`;
	for (const mode of ["subway", "bus"] as const) {
		const margin = result.mode[mode];
		const fallback =
			margin.marginSec === null
				? ` (표본 부족, 지금 설정값 ${modeSec[mode]}초 유지)`
				: "";
		lines.push(`${describe(mode, margin)}${fallback}`);
	}
	for (const [line, margin] of Object.entries(result.byLine)) {
		lines.push(describe(line, margin));
	}
	lines.push(
		"",
		`COMMUTE_LEAVE_MARGIN_SEC=${env.COMMUTE_LEAVE_MARGIN_SEC}`,
		`COMMUTE_LEAVE_MARGIN_BY_LINE=${env.COMMUTE_LEAVE_MARGIN_BY_LINE}`,
		""
	);
	process.stdout.write(lines.join("\n"));
}

main();

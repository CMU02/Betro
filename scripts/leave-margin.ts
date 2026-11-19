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
import { type LineRef, parseRef } from "../packages/commute/src/refs";
import {
	busBoards,
	parseRouteArrivals,
	type RouteStopArrival,
} from "../packages/commute/src/sources/seoul-bus";
import {
	type StationRow,
	stationBoard,
} from "../packages/commute/src/sources/seoul-subway";
import type { StopBoard } from "../packages/commute/src/sources/types";
import type { SubwayObservation } from "../packages/realtime/src/observation";
import { arrivalDirection } from "../packages/realtime/src/subway/reduce-arrivals";
import { kstToEpochMs } from "../packages/realtime/src/time";
import {
	type ArrivalRow,
	parseStationArrivalAll,
} from "../packages/realtime/src/upstream/subway-arrival";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 같은 차량이 이 간격 안에 다시 도착으로 잡히면 같은 도착이다(순환선·회차는 이보다 길다). */
const SAME_VISIT_MS = 30 * MINUTE_MS;
/** 실제 도착 구간이 이보다 넓으면 기록이 빈 것이라 뺀다. */
const MAX_ARRIVAL_SPAN_MS = 10 * MINUTE_MS;
/** 도착보다 이만큼 앞선 예측까지만 그 도착의 표본에 붙인다(예측 창보다 넉넉히). */
const PREDICTION_LOOKBACK_MS = 30 * MINUTE_MS;
const DEFAULT_MAX_SEC = 300;
const NDJSON_FILE = /\.ndjson(\.gz)?$/;
const GZIP_FILE = /\.gz$/;
const BACKSLASH = /\\/g;
const RAW_SUBWAY_DIR = "raw/subway-all/";
const EVENTS_SUBWAY_DIR = "events/subway/";

interface SubwayTarget {
	direction: "up" | "down";
	line: LineRef;
	mode: "subway";
	statnId: string;
}

interface BusTarget {
	line: LineRef;
	mode: "bus";
	routeId: string;
	seq: number | null;
	stId: string;
}

type Target = SubwayTarget | BusTarget;

type Prediction = MarginSample["predictions"][number];

// ── 공통 ────────────────────────────────────────────────────────────

function fail(message: string): never {
	throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
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

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key) ?? [];
	list.push(value);
	map.set(key, list);
}

/** 도착으로 잡힌 기록 → 도착 묶음마다 첫 기록. `SAME_VISIT_MS`보다 벌어지면 다른 도착이다. */
function firstOfVisits<T extends { sourceAt: number }>(records: T[]): T[] {
	const sorted = [...records].sort((a, b) => a.sourceAt - b.sourceAt);
	const firsts: T[] = [];
	let last: number | null = null;
	for (const record of sorted) {
		if (last === null || record.sourceAt - last > SAME_VISIT_MS) {
			firsts.push(record);
		}
		last = record.sourceAt;
	}
	return firsts;
}

/** 받은 시각 오름차순 `records`에서 `fetchedAt`이 `value`보다 이른 마지막 것. */
function latestBefore<T extends { fetchedAt: number }>(
	records: T[],
	value: number
): T | null {
	let found: T | null = null;
	for (const record of records) {
		if (record.fetchedAt >= value) {
			break;
		}
		found = record;
	}
	return found;
}

function sampleOf(
	target: Target,
	low: number,
	high: number,
	predictions: Prediction[]
): MarginSample | null {
	if (!(low < high && high - low <= MAX_ARRIVAL_SPAN_MS)) {
		return null;
	}
	return {
		high,
		line: target.line,
		low,
		mode: target.mode,
		predictions: predictions.filter(
			(prediction) =>
				prediction.at < high && prediction.at >= low - PREDICTION_LOOKBACK_MS
		),
	};
}

const liveOf = (method: string | null): boolean =>
	method !== null && method !== "timetable";

/** 도착판의 다가오는 차량 → 차량별 예측. */
function collectPredictions(
	board: StopBoard,
	at: number,
	into: Map<string, Prediction[]>
): void {
	for (const train of board.approaching) {
		if (train.etaAt !== null) {
			pushTo(into, train.vehicleId, {
				at,
				etaAt: train.etaAt,
				live: liveOf(train.method),
			});
		}
	}
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

/** 수집기 `stationRowOf`와 같은 변환(ALL 행 → 역 도착판 행). 역 ID를 함께 남긴다. */
function stationRowOf(
	row: ArrivalRow
): { row: StationRow; statnId: string } | null {
	const direction = arrivalDirection(row.updnLine);
	if (direction === null) {
		return null;
	}
	let sourceAt: number;
	try {
		sourceAt = kstToEpochMs(row.recptnDt);
	} catch {
		return null;
	}
	const barvlSec = Number(row.barvlDt ?? "0");
	return {
		row: {
			arvlCd: row.arvlCd,
			barvlSec: Number.isFinite(barvlSec) && barvlSec > 0 ? barvlSec : 0,
			direction,
			ordkey: row.ordkey,
			sourceAt,
			trainNo: row.btrainNo,
		},
		statnId: row.statnId,
	};
}

interface SubwaySnapshot {
	fetchedAt: number;
	/** 대상 역 → 그 역의 행. */
	rows: Map<string, StationRow[]>;
}

/**
 * 원본 한 줄 → 대상 역 행. 직전과 본문이 같아 해시만 남은 줄(`body` 없음)과 실패 응답은 뺀다.
 */
function subwaySnapshotOf(
	line: unknown,
	statnIds: ReadonlySet<string>
): SubwaySnapshot | null {
	if (!isRecord(line)) {
		return null;
	}
	const { body, fetchedAt } = line;
	if (typeof body !== "string" || typeof fetchedAt !== "number") {
		return null;
	}
	const parsed = parseStationArrivalAll(parseJson(body));
	if (!parsed.ok) {
		return null;
	}
	const rows = new Map<string, StationRow[]>();
	for (const arrival of parsed.rows) {
		if (!statnIds.has(arrival.statnId)) {
			continue;
		}
		const station = stationRowOf(arrival);
		if (station) {
			pushTo(rows, station.statnId, station.row);
		}
	}
	return { fetchedAt, rows };
}

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

function isSubwayArrive(value: unknown): value is SubwayObservation {
	return (
		isRecord(value) &&
		value.status === "arrive" &&
		typeof value.rawTrainNo === "string" &&
		typeof value.statnId === "string" &&
		typeof value.sourceAt === "number" &&
		typeof value.observedAt === "number"
	);
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

/**
 * 지하철 대상 하나의 표본. 예측은 스냅샷마다 `stationBoard`(노선 보정 포함)로 만든다.
 * 실제 도착은 이벤트에서 그 열차가 대상 역에 `arrive`로 처음 잡힌 원천 시각을 `high`로,
 * 그 이벤트를 낸 스냅샷 바로 앞 스냅샷의 원천 시각(그 역 행의 가장 늦은 `recptnDt`)을 `low`로
 * 둔다(실험 6). 이벤트의 `observedAt`은 원본 줄의 `fetchedAt`과 같은 값이라 스냅샷을 맞출 수 있다.
 * 이벤트를 낸 스냅샷 안에서는 행마다 `recptnDt`가 달라 그 역 시각이 `high`보다 이를 수 있으므로
 * 그 스냅샷의 시각은 `low`로 쓰지 않는다.
 */
function subwaySamplesFor(
	target: SubwayTarget,
	snapshots: SubwaySnapshot[],
	arrivals: SubwayObservation[],
	biasSec: number
): MarginSample[] {
	const predictions = new Map<string, Prediction[]>();
	/** 받은 시각 순서의 스냅샷마다 그 역 도착판의 원천 시각. */
	const boardTimes: { fetchedAt: number; sourceAt: number }[] = [];
	let prev: StationRow[] | null = null;
	for (const snapshot of snapshots) {
		const rows = snapshot.rows.get(target.statnId) ?? [];
		if (rows.length === 0) {
			continue;
		}
		const board = stationBoard(
			prev,
			rows,
			target.direction,
			biasSec,
			snapshot.fetchedAt
		);
		boardTimes.push({
			fetchedAt: snapshot.fetchedAt,
			sourceAt: board.sourceAt,
		});
		collectPredictions(board, snapshot.fetchedAt, predictions);
		prev = rows;
	}

	const arriveTimes = new Map<
		string,
		{ observedAt: number; sourceAt: number }[]
	>();
	for (const arrival of arrivals) {
		if (
			arrival.statnId === target.statnId &&
			arrival.direction === target.direction &&
			arrival.sourceAt !== null
		) {
			pushTo(arriveTimes, arrival.rawTrainNo, {
				observedAt: arrival.observedAt,
				sourceAt: arrival.sourceAt,
			});
		}
	}
	const samples: MarginSample[] = [];
	for (const [trainNo, times] of arriveTimes) {
		for (const first of firstOfVisits(times)) {
			const low = latestBefore(boardTimes, first.observedAt)?.sourceAt ?? null;
			const sample =
				low === null
					? null
					: sampleOf(
							target,
							low,
							first.sourceAt,
							predictions.get(trainNo) ?? []
						);
			if (sample) {
				samples.push(sample);
			}
		}
	}
	return samples;
}

// ── 버스 ────────────────────────────────────────────────────────────

interface BusResponse {
	fetchedAt: number;
	routeId: string | null;
	stops: RouteStopArrival[];
}

function timeOf(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/**
 * `/dump` 한 줄 → 노선 도착 응답. 실험 6 Worker의 줄 모양을 이 저장소에서 확인하지 못해
 * 여러 이름을 받는다(`fetchedAt`|`at`, `routeId`|`busRouteId`, `body`|`response`, 본문은
 * 문자열 JSON 또는 객체). 실패·빈 응답은 차량이 사라진 것으로 보지 않도록 뺀다.
 */
function busResponseOf(line: unknown): BusResponse | null {
	if (!isRecord(line)) {
		return null;
	}
	const fetchedAt = timeOf(line.fetchedAt ?? line.at);
	const rawBody = line.body ?? line.response;
	const body = typeof rawBody === "string" ? parseJson(rawBody) : rawBody;
	if (fetchedAt === null) {
		return null;
	}
	const parsed = parseRouteArrivals(body);
	if (!parsed.ok || parsed.stops.length === 0) {
		return null;
	}
	const routeId = line.routeId ?? line.busRouteId;
	return {
		fetchedAt,
		routeId: typeof routeId === "string" ? routeId : null,
		stops: parsed.stops,
	};
}

function readBusResponses(path: string): BusResponse[] {
	const responses: BusResponse[] = [];
	for (const line of jsonLines(path)) {
		const response = busResponseOf(line);
		if (response) {
			responses.push(response);
		}
	}
	return responses.sort((a, b) => a.fetchedAt - b.fetchedAt);
}

/**
 * 버스 대상 하나의 표본. 예측은 응답마다 `busBoards`의 대상 정류장 도착판이다.
 * 실제 도착은 차량이 대상 정류장 예측 목록에서 사라졌거나, 지났거나(`passed`), 정류장에
 * 있는(`stopsAway` 0) 첫 응답의 원천 시각을 `high`로, 직전 응답의 원천 시각을 `low`로 둔다.
 * 실패·빈 응답은 읽을 때 뺐으므로 "사라짐"은 성공한 두 응답 사이에서만 본다.
 */
function busSamplesFor(
	target: BusTarget,
	responses: BusResponse[]
): MarginSample[] {
	const predictions = new Map<string, Prediction[]>();
	const lastArrivedAt = new Map<string, number>();
	const arrivals: { high: number; low: number; vehicleId: string }[] = [];
	let prev: RouteStopArrival[] | null = null;
	/** 직전 응답에서 대상 정류장 목록에 있던 차량. */
	let prevListed = new Set<string>();
	for (const response of responses) {
		if (response.routeId !== null && response.routeId !== target.routeId) {
			continue;
		}
		const seq =
			target.seq ??
			response.stops.find((stop) => stop.stopId === target.stId)?.seq;
		if (seq === undefined) {
			continue;
		}
		const board = busBoards(prev, response.stops, response.fetchedAt).board(
			seq
		);
		collectPredictions(board, response.fetchedAt, predictions);
		const listed = new Set(
			board.approaching.map((vehicle) => vehicle.vehicleId)
		);
		const arrived = [
			...[...prevListed].filter((vehicleId) => !listed.has(vehicleId)),
			...board.passed.map((vehicle) => vehicle.vehicleId),
			...board.approaching
				.filter((vehicle) => vehicle.stopsAway === 0)
				.map((vehicle) => vehicle.vehicleId),
		];
		for (const vehicleId of new Set(arrived)) {
			const last = lastArrivedAt.get(vehicleId);
			const isNewVisit =
				last === undefined || board.sourceAt - last > SAME_VISIT_MS;
			if (isNewVisit && board.prevSourceAt !== undefined) {
				arrivals.push({
					high: board.sourceAt,
					low: board.prevSourceAt,
					vehicleId,
				});
			}
			lastArrivedAt.set(vehicleId, board.sourceAt);
		}
		prev = response.stops;
		prevListed = listed;
	}
	const samples: MarginSample[] = [];
	for (const arrival of arrivals) {
		const sample = sampleOf(
			target,
			arrival.low,
			arrival.high,
			predictions.get(arrival.vehicleId) ?? []
		);
		if (sample) {
			samples.push(sample);
		}
	}
	return samples;
}

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
	if (busTargets.length > 0 && busFile !== undefined) {
		const responses = readBusResponses(busFile);
		for (const target of busTargets) {
			samples.push(...busSamplesFor(target, responses));
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
			bus: diagnosticsOf(byMode("bus"), windowMin),
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

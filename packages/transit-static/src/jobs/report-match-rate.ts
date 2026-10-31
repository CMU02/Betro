import type { Database } from "@Betro/db";
import type { ServiceDay } from "@Betro/db/schema/transit";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCurrentTrips } from "../db/load";
import { isLineKey, LINES, type LineKey } from "../lines";
import { rawPath } from "../paths";
import {
	parseRealtimePosition,
	type RealtimeTrainRow,
} from "../realtime/position-parser";
import {
	TRAIN_NO_RULES,
	timetableTrainNoKey,
	trainNoCandidates,
} from "../realtime/train-no-rules";
import { writeReport } from "../reports";
import type { Trip } from "../timetable/model";

const JOB_NAME = "match-rate";
const SAMPLE_SOURCE = "realtime-sample";
/** fetch:realtime-sample가 쓰는 이름: `<lineKey>-<KST yyyymmddHHMM>.json`. */
const SAMPLE_FILE = /^(.+)-(\d{12})\.json$/;
const SATURDAY = 6;
const SUNDAY = 0;
const PERCENT = 100;

export interface MatchRateRow {
	lineKey: LineKey;
	matched: number;
	noRule: boolean;
	observed: number;
	/** matched / observed. 규칙이 없거나 그 요일 시간표가 없는 노선은 null. */
	rate: number | null;
	unmatched: string[];
}

export interface SampleFailure {
	code: string;
	fileName: string;
	lineKey: LineKey;
}

export interface ReportMatchRateOptions {
	dataDir: string;
	db: Database;
	now?: Date;
	/** 기본 `<dataDir>/raw/realtime-sample`. */
	sampleDir?: string;
	/** 안 주면 노선별 표본 파일 날짜의 요일로 정한다(공휴일 판정 없음). */
	serviceDay?: ServiceDay;
}

export interface ReportMatchRateResult {
	failures: SampleFailure[];
	linesWithoutSample: LineKey[];
	reportPaths: { jsonPath: string; mdPath: string };
	rows: MatchRateRow[];
	serviceDays: Partial<Record<LineKey, ServiceDay>>;
}

/** 실시간 directAt("1" 급행, "0" 아님)을 급행 여부로. 그 밖의 값은 모름. */
function expressOf(directAt: string): boolean | undefined {
	if (directAt === "1") {
		return true;
	}
	if (directAt === "0") {
		return false;
	}
	return undefined;
}

function matchLine(
	lineKey: LineKey,
	rows: readonly RealtimeTrainRow[],
	trips: readonly Trip[],
	serviceDay: ServiceDay
): MatchRateRow {
	const noRule = TRAIN_NO_RULES[lineKey] === null;
	const known = new Set(
		trips
			.filter((trip) => trip.serviceDay === serviceDay)
			.map((trip) => timetableTrainNoKey(lineKey, trip.trainNo))
	);
	if (noRule || known.size === 0) {
		return {
			lineKey,
			matched: 0,
			noRule,
			observed: rows.length,
			rate: null,
			unmatched: [],
		};
	}
	const unmatched: string[] = [];
	for (const row of rows) {
		const match = trainNoCandidates(lineKey, row.trainNo, {
			express: expressOf(row.directAt),
		});
		const hit = match?.candidates.some((candidate) => known.has(candidate));
		if (!hit) {
			unmatched.push(row.trainNo);
		}
	}
	const matched = rows.length - unmatched.length;
	return {
		lineKey,
		matched,
		noRule,
		observed: rows.length,
		rate: matched / rows.length,
		unmatched,
	};
}

/**
 * 관측된 열차를 노선별로 같은 (lineKey, serviceDay) 시간표 trip에 잇는다. 후보 번호 중 하나라도 있으면 매칭.
 * 방향은 조건에 넣지 않는다(2호선은 성수에서 번호가 바뀐다). 결과는 LINES 순서, 관측이 있는 노선만.
 */
export function matchObservations(
	rows: readonly RealtimeTrainRow[],
	tripsByLine: ReadonlyMap<LineKey, readonly Trip[]>,
	serviceDay: ServiceDay
): MatchRateRow[] {
	const rowsByLine = new Map<LineKey, RealtimeTrainRow[]>();
	for (const row of rows) {
		const list = rowsByLine.get(row.lineKey) ?? [];
		list.push(row);
		rowsByLine.set(row.lineKey, list);
	}
	const result: MatchRateRow[] = [];
	for (const { lineKey } of LINES) {
		const observed = rowsByLine.get(lineKey);
		if (observed) {
			result.push(
				matchLine(lineKey, observed, tripsByLine.get(lineKey) ?? [], serviceDay)
			);
		}
	}
	return result;
}

/** KST yyyymmdd의 요일로 서비스일을 정한다. 토요일 saturday, 일요일 holiday, 나머지 weekday. */
export function serviceDayOfStamp(stamp: string): ServiceDay {
	const year = Number(stamp.slice(0, 4));
	const month = Number(stamp.slice(4, 6));
	const day = Number(stamp.slice(6, 8));
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	if (weekday === SATURDAY) {
		return "saturday";
	}
	return weekday === SUNDAY ? "holiday" : "weekday";
}

interface LatestSample {
	fileName: string;
	stamp: string;
}

/** 노선별로 가장 최근(이름의 시각이 가장 큰) 표본 파일. 폴더가 없으면 빈 맵. */
async function latestSamples(
	sampleDir: string
): Promise<Map<LineKey, LatestSample>> {
	let names: string[];
	try {
		names = await readdir(sampleDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return new Map();
		}
		throw error;
	}
	const latest = new Map<LineKey, LatestSample>();
	for (const fileName of names) {
		const [, lineKey = "", stamp = ""] = SAMPLE_FILE.exec(fileName) ?? [];
		if (!isLineKey(lineKey)) {
			continue;
		}
		const current = latest.get(lineKey);
		if (!current || stamp > current.stamp) {
			latest.set(lineKey, { fileName, stamp });
		}
	}
	return latest;
}

function parseSample(bytes: Buffer): ReturnType<typeof parseRealtimePosition> {
	try {
		return parseRealtimePosition(JSON.parse(bytes.toString("utf8")));
	} catch {
		return { code: "MALFORMED", message: "not json", ok: false };
	}
}

function groupTrips(trips: readonly Trip[]): Map<LineKey, Trip[]> {
	const byLine = new Map<LineKey, Trip[]>();
	for (const trip of trips) {
		const list = byLine.get(trip.lineKey) ?? [];
		list.push(trip);
		byLine.set(trip.lineKey, list);
	}
	return byLine;
}

const formatRate = (row: MatchRateRow): string =>
	row.rate === null ? "-" : `${(row.rate * PERCENT).toFixed(1)}%`;

function rowNote(row: MatchRateRow): string {
	if (row.noRule) {
		return "규칙 없음(시간표 없음으로 넘김)";
	}
	return row.rate === null ? "그 요일 시간표 없음" : "";
}

interface SampleInfo extends LatestSample {
	code: string;
	lineKey: LineKey;
	rows: number;
	serviceDay: ServiceDay;
}

function renderMarkdown(
	rows: readonly MatchRateRow[],
	samples: readonly SampleInfo[],
	linesWithoutSample: readonly LineKey[],
	serviceDayGiven: boolean
): string {
	const lines = [
		"# 열차번호 매칭률",
		"",
		serviceDayGiven
			? "서비스일은 명령 인자로 정했다."
			: "서비스일은 표본 파일 날짜(KST)의 요일로 정했다. 공휴일은 판정하지 않는다.",
		"",
		"| 노선 | 관측 | 매칭 | 매칭률 | 비고 | 미매칭 번호 |",
		"|---|---|---|---|---|---|",
		...rows.map(
			(row) =>
				`| ${row.lineKey} | ${row.observed} | ${row.matched} | ${formatRate(row)} | ${rowNote(row)} | ${row.unmatched.join(", ")} |`
		),
		"",
		"## 표본",
		"",
		"| 노선 | 파일 | 서비스일 | 결과 | 행 수 |",
		"|---|---|---|---|---|",
		...samples.map(
			(s) =>
				`| ${s.lineKey} | ${s.fileName} | ${s.serviceDay} | ${s.code} | ${s.rows} |`
		),
		"",
		`표본 없는 노선: ${linesWithoutSample.length > 0 ? linesWithoutSample.join(", ") : "없음"}`,
		"",
	];
	return lines.join("\n");
}

/**
 * `raw/realtime-sample/`의 노선별 최신 표본을 현재 시간표 배치와 대조해 노선별 매칭률 보고서를 쓴다
 * (`reports/match-rate/`). 실패 응답 봉투는 failures로 따로 보고한다.
 */
export async function reportMatchRate(
	options: ReportMatchRateOptions
): Promise<ReportMatchRateResult> {
	const { dataDir, db, now = new Date() } = options;
	const sampleDir = options.sampleDir ?? rawPath(dataDir, SAMPLE_SOURCE, "");
	const latest = await latestSamples(sampleDir);
	const samples: SampleInfo[] = [];
	const failures: SampleFailure[] = [];
	const rowsByDay = new Map<ServiceDay, RealtimeTrainRow[]>();
	for (const { lineKey } of LINES) {
		const file = latest.get(lineKey);
		if (!file) {
			continue;
		}
		const serviceDay = options.serviceDay ?? serviceDayOfStamp(file.stamp);
		// biome-ignore lint/performance/noAwaitInLoops: 표본은 노선당 파일 하나, 많아야 19개다
		const parsed = parseSample(await readFile(join(sampleDir, file.fileName)));
		if (parsed.ok) {
			const dayRows = rowsByDay.get(serviceDay) ?? [];
			dayRows.push(...parsed.rows);
			rowsByDay.set(serviceDay, dayRows);
		} else {
			failures.push({ code: parsed.code, fileName: file.fileName, lineKey });
		}
		samples.push({
			...file,
			code: parsed.ok ? "INFO-000" : parsed.code,
			lineKey,
			rows: parsed.ok ? parsed.rows.length : 0,
			serviceDay,
		});
	}

	const tripsByLine = groupTrips(await loadCurrentTrips(db));
	const order = new Map(LINES.map(({ lineKey }, index) => [lineKey, index]));
	const rows = [...rowsByDay]
		.flatMap(([serviceDay, dayRows]) =>
			matchObservations(dayRows, tripsByLine, serviceDay)
		)
		.sort((a, b) => (order.get(a.lineKey) ?? 0) - (order.get(b.lineKey) ?? 0));
	const linesWithoutSample = LINES.map(({ lineKey }) => lineKey).filter(
		(lineKey) => !latest.has(lineKey)
	);
	const serviceDays: Partial<Record<LineKey, ServiceDay>> = {};
	for (const sample of samples) {
		serviceDays[sample.lineKey] = sample.serviceDay;
	}

	const reportPaths = await writeReport(
		dataDir,
		JOB_NAME,
		{
			markdown: renderMarkdown(
				rows,
				samples,
				linesWithoutSample,
				options.serviceDay !== undefined
			),
			summary: { failures, linesWithoutSample, rows, samples },
		},
		now
	);
	for (const row of rows) {
		console.log(
			`${row.lineKey}\t${row.matched}/${row.observed}\t${formatRate(row)}\t${rowNote(row)}`
		);
	}
	console.log(`보고서: ${reportPaths.mdPath}`);
	return { failures, linesWithoutSample, reportPaths, rows, serviceDays };
}

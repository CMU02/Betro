import type {
	ServiceDay,
	SourceManifest,
	TimetableSourceKind,
} from "@Betro/db/schema/transit";
import type { LineKey } from "../lines";
import type { ReportBody } from "../reports";
import type { UnresolvedStation } from "./resolve-station";
import type { TimetableIssue } from "./validate";

/** 보고서에 그대로 싣는 issue·출처 오류 개수. 나머지는 코드별 집계로만 보인다. */
export const REPORT_TOP_N = 50;
/** 기준일이 오늘보다 이만큼 넘게 오래된 출처를 신선도 경고로 표시한다. */
export const STALE_SOURCE_DAYS = 180;
const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE_DAYS: readonly ServiceDay[] = ["weekday", "saturday", "holiday"];

export interface LineReport {
	byServiceDay: Record<ServiceDay, number>;
	lineKey: LineKey;
	/** 쓸 수 없어 건너뛴 출처와 이유(수동 파일 없음, 키 없음, 원본 없음) */
	missing: string[];
	/** 토요일 trip이 휴일 복제(holiday-copied)인 노선 */
	saturdayCopied: boolean;
	sources: TimetableSourceKind[];
	trips: number;
	/** 이 노선에서 쓴 출처별 기준일 */
	versions: Partial<Record<TimetableSourceKind, string>>;
}

export interface TimetableReportInput {
	dryRun: boolean;
	/** timetable-station-aliases.json에서 statnId null로 뺀 대응표 범위 밖 역 */
	excludedStations: UnresolvedStation[];
	issues: TimetableIssue[];
	lines: LineReport[];
	linesWithoutTimetable: LineKey[];
	manifest: SourceManifest;
	now: Date;
	ok: boolean;
	/** 어댑터가 버린 행·열차와 읽지 못한 원본 */
	sourceErrors: string[];
	/** `<source>/<lineKey>` → 기준일 */
	sourceVersions: Record<string, string>;
	unresolvedStations: UnresolvedStation[];
}

export interface Freshness {
	ageDays?: number;
	key: string;
	stale: boolean;
	version: string;
}

/** 출처별 기준일의 나이. 날짜로 읽히지 않는 기준일("unknown")은 stale로 본다. */
export function freshnessOf(
	sourceVersions: Record<string, string>,
	now: Date
): Freshness[] {
	return Object.entries(sourceVersions)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, version]) => {
			if (!ISO_DATE.test(version)) {
				return { key, stale: true, version };
			}
			const ageDays = Math.floor(
				(now.getTime() - Date.parse(`${version}T00:00:00Z`)) / MS_PER_DAY
			);
			return { ageDays, key, stale: ageDays > STALE_SOURCE_DAYS, version };
		});
}

type IssueCounts = Record<string, { error: number; warn: number }>;

function countIssues(issues: TimetableIssue[]): IssueCounts {
	const counts: IssueCounts = {};
	for (const issue of issues) {
		const entry = counts[issue.code] ?? { error: 0, warn: 0 };
		entry[issue.severity] += 1;
		counts[issue.code] = entry;
	}
	return counts;
}

/** error를 먼저, 같은 등급 안에서는 검증 순서대로 앞의 REPORT_TOP_N건. */
function topIssues(issues: TimetableIssue[]): TimetableIssue[] {
	const errors = issues.filter((issue) => issue.severity === "error");
	const warns = issues.filter((issue) => issue.severity !== "error");
	return [...errors, ...warns].slice(0, REPORT_TOP_N);
}

const cell = (value: string | number | undefined): string =>
	String(value ?? "").replaceAll("|", "\\|");

const row = (values: (string | number | undefined)[]): string =>
	`| ${values.map(cell).join(" | ")} |`;

function linesSection(lines: LineReport[]): string[] {
	return [
		"## 노선별 출처",
		"",
		row(["노선", "출처", "기준일", "trip", ...SERVICE_DAYS, "건너뛴 출처"]),
		row(["---", "---", "---", "---", "---", "---", "---", "---"]),
		...lines.map((line) =>
			row([
				line.lineKey,
				line.sources.join(", ") || "-",
				Object.entries(line.versions)
					.map(([source, version]) => `${source} ${version}`)
					.join(", ") || "-",
				line.trips,
				...SERVICE_DAYS.map((day) => line.byServiceDay[day]),
				line.missing.join("; ") || "-",
			])
		),
		"",
	];
}

function issuesSection(issues: TimetableIssue[]): string[] {
	const counts = countIssues(issues);
	const top = topIssues(issues);
	return [
		"## 검증 결과",
		"",
		row(["code", "error", "warn"]),
		row(["---", "---", "---"]),
		...Object.entries(counts)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([code, c]) => row([code, c.error, c.warn])),
		"",
		`상위 ${top.length}건 (전체 ${issues.length}건):`,
		"",
		...top.map(
			(issue) =>
				`- [${issue.severity}] ${issue.code} ${issue.lineKey} ${issue.serviceDay} ${issue.trainNo}: ${issue.detail}`
		),
		"",
	];
}

function stationSection(
	title: string,
	unresolved: UnresolvedStation[]
): string[] {
	if (unresolved.length === 0) {
		return [title, "", "없음", ""];
	}
	return [
		title,
		"",
		row(["출처", "노선", "코드", "역명", "빈도"]),
		row(["---", "---", "---", "---", "---"]),
		...unresolved.map((u) =>
			row([u.source, u.lineKey, u.code, u.name, u.count])
		),
		"",
	];
}

function freshnessSection(freshness: Freshness[]): string[] {
	return [
		`## 신선도 (기준일이 ${STALE_SOURCE_DAYS}일 넘게 지난 출처는 STALE)`,
		"",
		...freshness.map(
			(f) =>
				`- ${f.key}: ${f.version}${f.ageDays === undefined ? "" : ` (${f.ageDays}일)`}${f.stale ? " **STALE**" : ""}`
		),
		"",
	];
}

function bulletList(title: string, items: string[]): string[] {
	return [
		title,
		"",
		...(items.length === 0 ? ["없음"] : items.map((item) => `- ${item}`)),
		"",
	];
}

/** build-timetable 보고서(JSON 요약과 Markdown). issue와 출처 오류는 집계와 상위 REPORT_TOP_N건만 싣는다. */
export function renderTimetableReport(input: TimetableReportInput): ReportBody {
	const freshness = freshnessOf(input.sourceVersions, input.now);
	const saturdayCopiedLines = input.lines
		.filter((line) => line.saturdayCopied)
		.map((line) => line.lineKey);
	const sourceErrors = input.sourceErrors.slice(0, REPORT_TOP_N);
	const errorCount = input.issues.filter((i) => i.severity === "error").length;
	const summary = {
		dryRun: input.dryRun,
		excludedStations: input.excludedStations,
		freshness,
		generatedAt: input.now.toISOString(),
		issueCounts: countIssues(input.issues),
		issueTotal: input.issues.length,
		lines: input.lines,
		linesWithoutTimetable: input.linesWithoutTimetable,
		manifest: input.manifest,
		ok: input.ok,
		saturdayCopiedLines,
		sourceErrors,
		sourceErrorTotal: input.sourceErrors.length,
		sourceVersions: input.sourceVersions,
		topIssues: topIssues(input.issues),
		unresolvedStations: input.unresolvedStations,
	};
	const markdown = [
		"# build-timetable 보고서",
		"",
		`- 생성: ${input.now.toISOString()}${input.dryRun ? " (dry-run)" : ""}`,
		`- ok: ${input.ok} (error ${errorCount}건, 대응표에 없는 역 ${input.unresolvedStations.length}건)`,
		`- trip: ${input.lines.reduce((sum, line) => sum + line.trips, 0)}`,
		"",
		...linesSection(input.lines),
		...bulletList(
			"## 시간표 없는 노선 (linesWithoutTimetable, ok에 영향 없음)",
			input.linesWithoutTimetable
		),
		...bulletList("## 토요일을 휴일로 복제한 노선", saturdayCopiedLines),
		...freshnessSection(freshness),
		...issuesSection(input.issues),
		...stationSection("## 대응표에 없는 역", input.unresolvedStations),
		...stationSection(
			"## 대응표 범위 밖으로 뺀 역 (별칭 statnId null, ok에 영향 없음)",
			input.excludedStations
		),
		...bulletList(
			`## 출처 오류 (상위 ${sourceErrors.length}건, 전체 ${input.sourceErrors.length}건)`,
			sourceErrors
		),
		"## 원본 manifest",
		"",
		...Object.entries(input.manifest).map(
			([key, entry]) => `- ${key}: ${entry.fileName} (${entry.sha256})`
		),
		"",
	].join("\n");
	return { markdown, summary };
}

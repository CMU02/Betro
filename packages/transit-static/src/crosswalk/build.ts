import type {
	StationMasterRow,
	StationSearchRow,
} from "../sources/seoul-open-api";
import type { RealtimeStationRow } from "../sources/station-xlsx";
import { attachStationCodes } from "./attach-codes";
import { diffStationLists, type StationListDiff } from "./diff";
import {
	type CrosswalkRow,
	type MatchMethod,
	matchStations,
	type StationAlias,
} from "./match";
import type { ManualLineNameTable } from "./source-line-names";

export interface BuildCrosswalkInput {
	aliases: StationAlias[];
	lineNames: ManualLineNameTable;
	master: StationMasterRow[];
	prevStations?: RealtimeStationRow[];
	/** 키는 xlsx 원문 역명(OA-121 조회에 쓴 이름). */
	searchByName: Map<string, StationSearchRow[]>;
	stations: RealtimeStationRow[];
}

export interface BuildCrosswalkResult {
	diff?: StationListDiff;
	markdown: string;
	/** OA-121 코드를 못 붙인 statnId. 경고일 뿐 ok에는 영향이 없다. */
	missingCodes: string[];
	ok: boolean;
	rows: CrosswalkRow[];
	unmappedLineNums: { lineNum: string; count: number }[];
	unmappedRoutes: { route: string; count: number }[];
	unmatched: RealtimeStationRow[];
}

interface IgnoredCount {
	masterCount: number;
	name: string;
	searchCount: number;
}

const MATCH_METHODS: readonly MatchMethod[] = [
	"auto-same-line",
	"auto-shared",
	"manual-alias",
];

function stationLine(station: RealtimeStationRow): string {
	return `| ${station.statnId} | ${station.lineKey} (${station.lineNameRaw}) | ${station.nameRaw} |`;
}

function stationTable(stations: RealtimeStationRow[]): string[] {
	return [
		"| statnId | 노선 | 역명 |",
		"|---|---|---|",
		...stations.map(stationLine),
	];
}

function countIgnored(input: BuildCrosswalkInput): IgnoredCount[] {
	return (input.lineNames.ignoredRoutes ?? []).map((name) => {
		let searchCount = 0;
		for (const candidates of input.searchByName.values()) {
			searchCount += candidates.filter((c) => c.lineNum === name).length;
		}
		return {
			masterCount: input.master.filter((record) => record.route === name)
				.length,
			name,
			searchCount,
		};
	});
}

function summarySection(
	input: BuildCrosswalkInput,
	result: Omit<BuildCrosswalkResult, "markdown">
): string[] {
	const lineCount = new Set(result.rows.map((row) => row.lineKey)).size;
	return [
		"# 역 대응표 빌드 보고서",
		"",
		`- 결과: ${result.ok ? "성공" : "실패"}`,
		`- 매칭 ${result.rows.length} / ${input.stations.length}`,
		`- 노선 ${lineCount}개`,
	];
}

export function countByMatchMethod(
	rows: CrosswalkRow[]
): Record<MatchMethod, number> {
	const counts: Record<MatchMethod, number> = {
		"auto-same-line": 0,
		"auto-shared": 0,
		"manual-alias": 0,
	};
	for (const row of rows) {
		counts[row.matchMethod] += 1;
	}
	return counts;
}

function methodSection(rows: CrosswalkRow[]): string[] {
	const lines = ["", "## 매칭 방법별 건수", ""];
	const counts = countByMatchMethod(rows);
	for (const method of MATCH_METHODS) {
		lines.push(`- ${method}: ${counts[method]}`);
	}
	const shared = rows.filter((row) => row.matchMethod === "auto-shared");
	if (shared.length > 0) {
		lines.push(
			"",
			"### 공용역 매칭(auto-shared) 검토 목록",
			"",
			"다른 노선 레코드의 좌표를 쓴 역이다. 같은 이름의 다른 역에 붙지 않았는지 확인한다.",
			"",
			"| statnId | 노선 | 역명 | bldnId |",
			"|---|---|---|---|",
			...shared.map(
				(row) =>
					`| ${row.statnId} | ${row.lineKey} | ${row.nameCanonical} | ${row.bldnId} |`
			)
		);
	}
	return lines;
}

function unmatchedSection(unmatched: RealtimeStationRow[]): string[] {
	const lines = ["", `## 미매칭 역 (${unmatched.length})`, ""];
	if (unmatched.length === 0) {
		lines.push("없음");
		return lines;
	}
	lines.push(...stationTable(unmatched));
	return lines;
}

function countList(
	title: string,
	items: { name: string; count: number }[]
): string[] {
	const lines = ["", `### ${title} (${items.length})`, ""];
	if (items.length === 0) {
		lines.push("없음");
		return lines;
	}
	lines.push(...items.map((item) => `- \`${item.name}\`: ${item.count}건`));
	return lines;
}

function lineNameSection(
	result: Omit<BuildCrosswalkResult, "markdown">,
	ignored: IgnoredCount[]
): string[] {
	const lines = [
		"",
		"## 매핑 안 된 노선 문자열",
		...countList(
			"역사마스터 ROUTE",
			result.unmappedRoutes.map((u) => ({ count: u.count, name: u.route }))
		),
		...countList(
			"OA-121 LINE_NUM",
			result.unmappedLineNums.map((u) => ({ count: u.count, name: u.lineNum }))
		),
		"",
		`### 범위 밖 (ignoredRoutes, ${ignored.length})`,
		"",
	];
	if (ignored.length === 0) {
		lines.push("없음");
		return lines;
	}
	lines.push(
		...ignored.map(
			(item) =>
				`- \`${item.name}\`: 역사마스터 ${item.masterCount}건, OA-121 ${item.searchCount}건`
		)
	);
	return lines;
}

function missingCodesSection(missingCodes: string[]): string[] {
	const lines = ["", `## 코드 없는 역 (경고): ${missingCodes.length}`];
	if (missingCodes.length > 0) {
		lines.push("", missingCodes.join(", "));
	}
	return lines;
}

function diffSection(diff: StationListDiff | undefined): string[] {
	const lines = ["", "## 판 차이 (이전 xlsx 대비)", ""];
	if (!diff) {
		lines.push("이전 판 없음");
		return lines;
	}
	lines.push(
		`- 추가 ${diff.added.length}, 삭제 ${diff.removed.length}, 개명 ${diff.renamed.length}`
	);
	if (diff.added.length > 0) {
		lines.push("", "### 추가", "", ...stationTable(diff.added));
	}
	if (diff.removed.length > 0) {
		lines.push("", "### 삭제", "", ...stationTable(diff.removed));
	}
	if (diff.renamed.length > 0) {
		lines.push(
			"",
			"### 개명",
			"",
			...diff.renamed.map((r) => `- ${r.statnId}: ${r.from} → ${r.to}`)
		);
	}
	return lines;
}

/**
 * 실시간 역 목록을 역사마스터에 맞추고(matchStations) OA-121 코드를 붙인(attachStationCodes) 뒤
 * 사람이 읽는 Markdown 보고서를 만든다. 매칭 안 된 역이나 매핑 안 된 노선 문자열이 있으면 ok=false다.
 */
export function buildCrosswalk(
	input: BuildCrosswalkInput
): BuildCrosswalkResult {
	const ignoredRoutes = input.lineNames.ignoredRoutes ?? [];
	const matched = matchStations({
		aliases: input.aliases,
		ignoredRoutes,
		lineNames: input.lineNames,
		master: input.master,
		stations: input.stations,
	});
	const coded = attachStationCodes(
		matched.rows,
		input.searchByName,
		input.lineNames,
		ignoredRoutes
	);
	const diff = input.prevStations
		? diffStationLists(input.prevStations, input.stations)
		: undefined;
	const result: Omit<BuildCrosswalkResult, "markdown"> = {
		diff,
		missingCodes: coded.missingCodes,
		ok:
			matched.unmatched.length === 0 &&
			matched.unmappedRoutes.length === 0 &&
			coded.unmappedLineNums.length === 0,
		rows: coded.rows,
		unmappedLineNums: coded.unmappedLineNums,
		unmappedRoutes: matched.unmappedRoutes,
		unmatched: matched.unmatched,
	};
	const markdown = [
		...summarySection(input, result),
		...methodSection(result.rows),
		...unmatchedSection(result.unmatched),
		...lineNameSection(result, countIgnored(input)),
		...missingCodesSection(result.missingCodes),
		...diffSection(diff),
		"",
	].join("\n");
	return { ...result, markdown };
}

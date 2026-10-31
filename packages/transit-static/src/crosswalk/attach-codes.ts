import type { StationSearchRow } from "../sources/seoul-open-api";
import type { CrosswalkRow } from "./match";
import {
	mapSourceLineName,
	type SourceLineNameTable,
} from "./source-line-names";

export const NO_STATION_CD_FLAG = "no-station-cd";

export interface AttachCodesResult {
	missingCodes: string[];
	rows: CrosswalkRow[];
	unmappedLineNums: { lineNum: string; count: number }[];
}

function countUnmappedLineNums(
	searchByName: Map<string, StationSearchRow[]>,
	lineNames: SourceLineNameTable
): { lineNum: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const candidates of searchByName.values()) {
		for (const candidate of candidates) {
			if (
				mapSourceLineName(
					"stationSearchLineNum",
					candidate.lineNum,
					lineNames
				) === undefined
			) {
				counts.set(candidate.lineNum, (counts.get(candidate.lineNum) ?? 0) + 1);
			}
		}
	}
	return [...counts].map(([lineNum, count]) => ({ count, lineNum }));
}

/**
 * 역별 OA-121 검색 결과에서 같은 노선(lineKey)의 행을 골라 stationCd, frCode를 붙인다.
 * 조회 키는 xlsx 원문 역명이며, CrosswalkRow에서는 nameAliases[0]이 그 원문이다(toRow 참고).
 * 코드가 없어도 행은 버리지 않고 no-station-cd 플래그와 missingCodes로 표시한다.
 */
export function attachStationCodes(
	rows: CrosswalkRow[],
	searchByName: Map<string, StationSearchRow[]>,
	lineNames: SourceLineNameTable
): AttachCodesResult {
	const missingCodes: string[] = [];
	const attached: CrosswalkRow[] = [];
	for (const row of rows) {
		const rawName = row.nameAliases[0] ?? "";
		const candidates = searchByName.get(rawName) ?? [];
		const match = candidates.find(
			(candidate) =>
				mapSourceLineName(
					"stationSearchLineNum",
					candidate.lineNum,
					lineNames
				) === row.lineKey
		);
		if (match) {
			attached.push({
				...row,
				frCode: match.frCode,
				stationCd: match.stationCd,
			});
			continue;
		}
		missingCodes.push(row.statnId);
		attached.push({
			...row,
			qualityFlags: [...row.qualityFlags, NO_STATION_CD_FLAG],
		});
	}
	return {
		missingCodes,
		rows: attached,
		unmappedLineNums: countUnmappedLineNums(searchByName, lineNames),
	};
}

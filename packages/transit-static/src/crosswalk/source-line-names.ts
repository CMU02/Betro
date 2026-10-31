import { LINES, type LineKey } from "../lines";
import sourceLineNames from "../manual/source-line-names.json" with {
	type: "json",
};

export type SourceLineNameKind = "stationMasterRoute" | "stationSearchLineNum";

/** 출처별 노선 문자열 → lineKey. 값은 런타임에 LINES로 검증한다. */
export type SourceLineNameTable = Record<
	SourceLineNameKind,
	Record<string, string>
>;

/**
 * 매뉴얼 파일(`manual/source-line-names.json`) 전체 형태.
 * ignoredRoutes는 범위 밖 노선 문자열(예: 인천1호선)로, 매핑하지 않고 unmapped 집계에서도 뺀다.
 * 역사마스터 ROUTE와 OA-121 LINE_NUM 양쪽에 같은 목록을 쓴다.
 */
export type ManualLineNameTable = SourceLineNameTable & {
	ignoredRoutes?: string[];
};

export const manualTable: ManualLineNameTable = sourceLineNames;

const LINE_KEYS: ReadonlySet<string> = new Set(
	LINES.map((line) => line.lineKey)
);

function isLineKey(value: string): value is LineKey {
	return LINE_KEYS.has(value);
}

export function mapSourceLineName(
	kind: SourceLineNameKind,
	raw: string,
	table: SourceLineNameTable = manualTable
): LineKey | undefined {
	const names = table[kind];
	const key = raw.trim();
	if (!Object.hasOwn(names, key)) {
		return undefined;
	}
	const value = names[key];
	return value !== undefined && isLineKey(value) ? value : undefined;
}

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

export const manualTable: SourceLineNameTable = sourceLineNames;

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

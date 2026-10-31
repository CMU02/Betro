export type LineKey =
	| "line1"
	| "line2"
	| "line3"
	| "line4"
	| "line5"
	| "line6"
	| "line7"
	| "line8"
	| "line9"
	| "gyeongui-jungang"
	| "airport"
	| "gyeongchun"
	| "suin-bundang"
	| "shinbundang"
	| "ui-sinseol"
	| "seohae"
	| "gyeonggang"
	| "gtx-a"
	| "sillim";

export interface LineInfo {
	lineKey: LineKey;
	nameKo: string;
	subwayId: string;
}

/** 실시간 API가 응답하는 19개 노선 (서울 밖 구간 포함). */
export const LINES: readonly LineInfo[] = [
	{ lineKey: "line1", nameKo: "1호선", subwayId: "1001" },
	{ lineKey: "line2", nameKo: "2호선", subwayId: "1002" },
	{ lineKey: "line3", nameKo: "3호선", subwayId: "1003" },
	{ lineKey: "line4", nameKo: "4호선", subwayId: "1004" },
	{ lineKey: "line5", nameKo: "5호선", subwayId: "1005" },
	{ lineKey: "line6", nameKo: "6호선", subwayId: "1006" },
	{ lineKey: "line7", nameKo: "7호선", subwayId: "1007" },
	{ lineKey: "line8", nameKo: "8호선", subwayId: "1008" },
	{ lineKey: "line9", nameKo: "9호선", subwayId: "1009" },
	{ lineKey: "gyeongui-jungang", nameKo: "경의중앙선", subwayId: "1063" },
	{ lineKey: "airport", nameKo: "공항철도", subwayId: "1065" },
	{ lineKey: "gyeongchun", nameKo: "경춘선", subwayId: "1067" },
	{ lineKey: "suin-bundang", nameKo: "수인분당선", subwayId: "1075" },
	{ lineKey: "shinbundang", nameKo: "신분당선", subwayId: "1077" },
	{ lineKey: "ui-sinseol", nameKo: "우이신설선", subwayId: "1092" },
	{ lineKey: "seohae", nameKo: "서해선", subwayId: "1093" },
	{ lineKey: "gyeonggang", nameKo: "경강선", subwayId: "1081" },
	{ lineKey: "gtx-a", nameKo: "GTX-A", subwayId: "1032" },
	{ lineKey: "sillim", nameKo: "신림선", subwayId: "1094" },
];

export function lineKeyBySubwayId(subwayId: string): LineKey | undefined {
	return LINES.find((line) => line.subwayId === subwayId)?.lineKey;
}

const LINE_KEYS: ReadonlySet<string> = new Set(
	LINES.map((line) => line.lineKey)
);

export function isLineKey(value: string): value is LineKey {
	return LINE_KEYS.has(value);
}

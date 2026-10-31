import { readSheet } from "read-excel-file/node";
import { type LineKey, lineKeyBySubwayId } from "../lines";

export interface RealtimeStationRow {
	lineKey: LineKey;
	lineNameRaw: string;
	nameRaw: string;
	statnId: string;
	subwayId: string;
}

// datafile.seoul.go.kr은 HTTPS를 지원하므로 HTTPS를 쓴다.
const STATION_XLSX_BASE =
	"https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-12764&seqNo=&seq=";
const STATION_XLSX_TAIL = "&infSeq=2";

export function stationXlsxUrl(seq: number): string {
	return `${STATION_XLSX_BASE}${seq}${STATION_XLSX_TAIL}`;
}

const HEADER_SUBWAY_ID = "SUBWAY_ID";
const HEADER_STATN_ID = "STATN_ID";
const HEADER_STATN_NM = "STATN_NM";
const HEADER_LINE_NAME = "호선이름";

function cellToString(cell: unknown): string {
	if (cell === null || cell === undefined) {
		return "";
	}
	return String(cell).trim();
}

export function parseStationRows(rows: unknown[][]): {
	rows: RealtimeStationRow[];
	errors: string[];
} {
	const out: RealtimeStationRow[] = [];
	const errors: string[] = [];
	const header = (rows[0] ?? []).map(cellToString);
	const subwayIdCol = header.indexOf(HEADER_SUBWAY_ID);
	const statnIdCol = header.indexOf(HEADER_STATN_ID);
	const nameCol = header.indexOf(HEADER_STATN_NM);
	const lineNameCol = header.indexOf(HEADER_LINE_NAME);
	if ([subwayIdCol, statnIdCol, nameCol, lineNameCol].includes(-1)) {
		return {
			errors: [`missing header column in: ${header.join(",")}`],
			rows: out,
		};
	}

	for (const [i, row] of rows.entries()) {
		if (i === 0) {
			continue;
		}
		const rowNumber = i + 1;
		const subwayId = cellToString(row[subwayIdCol]);
		const statnId = cellToString(row[statnIdCol]);
		if (subwayId === "" && statnId === "") {
			continue;
		}
		const lineKey = lineKeyBySubwayId(subwayId);
		if (!lineKey) {
			errors.push(`unknown subwayId ${subwayId} at row ${rowNumber}`);
			continue;
		}
		out.push({
			lineKey,
			lineNameRaw: cellToString(row[lineNameCol]),
			nameRaw: cellToString(row[nameCol]),
			statnId,
			subwayId,
		});
	}
	return { errors, rows: out };
}

/** 첫 시트의 모든 행을 읽는다. */
export async function readStationXlsx(path: string): Promise<unknown[][]> {
	return await readSheet(path, 1);
}

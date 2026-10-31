import { readSheet } from "read-excel-file/node";
import { saveRaw } from "../raw-store";
import { fileNameFromResponse } from "./seoul-metro-csv";

/** KRIC(한국철도공사 철도정보포털) 전체 도시철도 운행정보 파일(id=900). 키 없이 받는다. */
export const KRIC_FILE_URL =
	"https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=900&operation=1";

export const KRIC_RAW_SOURCE = "kric-timetable";

const XLSX_MAGIC = [0x50, 0x4b] as const;

const COLUMNS = {
	arrive: "정거장도착시각",
	dataDate: "데이터기준일자",
	day: "요일구분",
	depart: "정가장출발시각",
	destination: "운행구간종점명",
	lineName: "노선명",
	operator: "운영기관전화번호",
	origin: "운행구간기점명",
	serviceType: "운행유형",
	station: "운행구간정거장",
	trainNo: "열차번호",
} as const;

/** 파일 한 행. 묶음 문자열 노선("토요일+공휴일" 등)은 그대로 두고 Task 6이 읽는다. */
export interface KricRow {
	arrive: string | null;
	/** 출처 기준일(YYYY-MM-DD). 없으면 빈 문자열. */
	dataDate: string;
	dayLabel: string;
	depart: string | null;
	destination: string;
	lineName: string;
	/** 파일에 운영기관 이름 열이 없어 운영기관전화번호 칸을 쓴다. */
	operator: string;
	origin: string;
	/** 원본 행 전체(머리글 이름 → 값). */
	raw: Record<string, unknown>;
	/** 운행유형: 일반, 급행, 직통. */
	serviceType: string;
	stationName: string;
	trainNo: string;
}

function cellToString(cell: unknown): string {
	if (cell === null || cell === undefined) {
		return "";
	}
	return String(cell).trim();
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

/** 시각 칸은 엑셀 시각(Date, 1899-12-30 기준 UTC)이거나 "HH:MM:SS" 문자열이다. */
function clockCell(cell: unknown): string | null {
	if (cell instanceof Date) {
		return `${pad2(cell.getUTCHours())}:${pad2(cell.getUTCMinutes())}:${pad2(cell.getUTCSeconds())}`;
	}
	const text = cellToString(cell);
	return text === "" ? null : text;
}

function dateCell(cell: unknown): string {
	if (cell instanceof Date) {
		return cell.toISOString().slice(0, 10);
	}
	return cellToString(cell);
}

/** 첫 행을 머리글로 보고 이름으로 열을 찾아 KricRow로 바꾼다. 필요한 열이 없으면 던진다. */
export function parseKricSheet(rows: unknown[][]): KricRow[] {
	const header = (rows[0] ?? []).map(cellToString);
	const missing = Object.values(COLUMNS).filter(
		(name) => !header.includes(name)
	);
	if (missing.length > 0) {
		throw new Error(
			`KRIC file is missing header column(s): ${missing.join(", ")}`
		);
	}
	const col = (name: string) => header.indexOf(name);
	const c = {
		arrive: col(COLUMNS.arrive),
		dataDate: col(COLUMNS.dataDate),
		day: col(COLUMNS.day),
		depart: col(COLUMNS.depart),
		destination: col(COLUMNS.destination),
		lineName: col(COLUMNS.lineName),
		operator: col(COLUMNS.operator),
		origin: col(COLUMNS.origin),
		serviceType: col(COLUMNS.serviceType),
		station: col(COLUMNS.station),
		trainNo: col(COLUMNS.trainNo),
	};
	const out: KricRow[] = [];
	for (const row of rows.slice(1)) {
		const trainNo = cellToString(row[c.trainNo]);
		const stationName = cellToString(row[c.station]);
		if (trainNo === "" && stationName === "") {
			continue;
		}
		const raw: Record<string, unknown> = {};
		for (const [index, name] of header.entries()) {
			raw[name] = row[index] ?? null;
		}
		out.push({
			arrive: clockCell(row[c.arrive]),
			dataDate: dateCell(row[c.dataDate]),
			dayLabel: cellToString(row[c.day]),
			depart: clockCell(row[c.depart]),
			destination: cellToString(row[c.destination]),
			lineName: cellToString(row[c.lineName]),
			operator: cellToString(row[c.operator]),
			origin: cellToString(row[c.origin]),
			raw,
			serviceType: cellToString(row[c.serviceType]),
			stationName,
			trainNo,
		});
	}
	return out;
}

/** xlsx 바이트의 첫 시트를 KricRow[]로 읽는다. */
export async function readKricRows(bytes: Uint8Array): Promise<KricRow[]> {
	return parseKricSheet(await readSheet(Buffer.from(bytes), 1));
}

/** 원본 xlsx를 받아 data/raw/kric-timetable/<원본 파일명>에 그대로 저장한다. */
export async function fetchKricFile(
	dataDir: string,
	url: string = KRIC_FILE_URL,
	fetchImpl: typeof fetch = fetch
): Promise<{
	fileName: string;
	path: string;
	sha256: string;
	unchanged: boolean;
}> {
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(`KRIC file download failed: ${response.status} ${url}`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes[0] !== XLSX_MAGIC[0] || bytes[1] !== XLSX_MAGIC[1]) {
		throw new Error(`KRIC file response is not a valid xlsx (zip): ${url}`);
	}
	const fileName = fileNameFromResponse(response, "kric-timetable.xlsx");
	const saved = await saveRaw(dataDir, KRIC_RAW_SOURCE, fileName, bytes);
	return { fileName, ...saved };
}

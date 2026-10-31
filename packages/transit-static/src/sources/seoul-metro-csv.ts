import type {
	ExpressKind,
	ServiceDay,
	TrackDirection,
} from "@Betro/db/schema/transit";
import { basename } from "node:path";
import { parse } from "csv-parse/sync";
import iconv from "iconv-lite";
import type { LineKey } from "../lines";
import { saveRaw } from "../raw-store";
import { parseClock } from "../timetable/clock";
import type { SourceStop, SourceTrip } from "../timetable/model";

/** 서울교통공사 도시철도 열차운행시각표(data.go.kr 15098251) 파일. 판이 바뀌면 호출자가 URL을 넘긴다. */
export const SEOUL_METRO_CSV_URL =
	"https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007671122&fileDetailSn=1";

export const SEOUL_METRO_RAW_SOURCE = "seoul-metro-timetable";
const FALLBACK_FILE_NAME = "timetable.csv";

const COLUMNS = {
	arrive: "열차도착시간",
	day: "주중주말",
	depart: "열차출발시간",
	direction: "방향",
	express: "급행여부",
	line: "호선",
	stationCode: "역사코드",
	stationName: "역사명",
	trainCode: "열차코드",
} as const;

const SERVICE_DAYS: Readonly<Record<string, ServiceDay>> = {
	DAY: "weekday",
	END: "holiday",
	SAT: "saturday",
};

/** 상행·내선 = up. 2호선 본선만 IN/OUT을 쓰고 지선은 UP/DOWN이다. */
const DIRECTIONS: Readonly<Record<string, TrackDirection>> = {
	DOWN: "down",
	IN: "up",
	OUT: "down",
	UP: "up",
};

const EXPRESS_FLAG = "1";
const DUPLICATE_STOP_FLAG = "duplicate-stop";
const SEOUL_METRO_LINE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** 실제 파일은 "1"…"9", 다른 판이나 문서는 "1호선"…"9호선"으로 쓴다. 둘 다 받는다. */
const LINE_KEYS: ReadonlyMap<string, LineKey> = new Map(
	SEOUL_METRO_LINE_NUMBERS.flatMap((n): [string, LineKey][] => [
		[String(n), `line${n}`],
		[`${n}호선`, `line${n}`],
	])
);

/** 머리글 행이 1행이므로 데이터 레코드 i(0부터)는 파일의 i+2행이다. */
const FIRST_DATA_ROW = 2;
const SOURCE_VERSION_PATTERN = /_(\d{4})(\d{2})(\d{2})(?:\.[^.]*)?$/;

export function decodeCp949(bytes: Uint8Array): string {
	return iconv.decode(
		Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
		"cp949"
	);
}

/** 파일명의 `_YYYYMMDD`를 출처 기준일 `YYYY-MM-DD`로. 없으면 "unknown". */
export function seoulMetroSourceVersion(fileName: string): string {
	const match = SOURCE_VERSION_PATTERN.exec(fileName);
	if (!match) {
		return "unknown";
	}
	return `${match[1]}-${match[2]}-${match[3]}`;
}

interface StopRow {
	arrive: string | null;
	code: string;
	depart: string | null;
	name: string;
	/** 정렬 기준(초). 같은 역의 도착이 출발보다 앞선다. */
	orderSec: number;
	tieSec: number;
}

interface TripGroup {
	direction: TrackDirection;
	express: ExpressKind;
	lineKey: LineKey;
	rows: StopRow[];
	serviceDay: ServiceDay;
	trainNo: string;
}

type CsvRecord = Record<string, string | undefined>;

function cell(record: CsvRecord, column: string): string {
	return (record[column] ?? "").trim();
}

/** "00:00:00"과 빈 칸은 null. 그 밖의 값은 원문 그대로 두고, 잘못된 시각이면 parseClock이 던진다. */
function readClock(text: string): { raw: string | null; sec: number | null } {
	const sec = parseClock(text, { midnightIsNull: true });
	return { raw: sec === null ? null : text, sec };
}

type ParsedRow =
	| { error: string }
	| {
			direction: TrackDirection;
			express: ExpressKind;
			key: string;
			lineKey: LineKey;
			serviceDay: ServiceDay;
			stop: StopRow;
			trainNo: string;
	  };

function parseRow(record: CsvRecord, rowNumber: number): ParsedRow {
	const lineText = cell(record, COLUMNS.line);
	const dayText = cell(record, COLUMNS.day);
	const directionText = cell(record, COLUMNS.direction);
	const lineKey = LINE_KEYS.get(lineText);
	if (!lineKey) {
		return { error: `unknown 호선 "${lineText}" at row ${rowNumber}` };
	}
	const serviceDay = SERVICE_DAYS[dayText];
	if (!serviceDay) {
		return { error: `unknown 주중주말 "${dayText}" at row ${rowNumber}` };
	}
	const direction = DIRECTIONS[directionText];
	if (!direction) {
		return { error: `unknown 방향 "${directionText}" at row ${rowNumber}` };
	}
	const trainNo = cell(record, COLUMNS.trainCode);
	const code = cell(record, COLUMNS.stationCode);
	if (trainNo === "" || code === "") {
		return { error: `empty 열차코드 or 역사코드 at row ${rowNumber}` };
	}
	let arrive: ReturnType<typeof readClock>;
	let depart: ReturnType<typeof readClock>;
	try {
		arrive = readClock(cell(record, COLUMNS.arrive));
		depart = readClock(cell(record, COLUMNS.depart));
	} catch (error) {
		return { error: `${(error as Error).message} at row ${rowNumber}` };
	}
	const orderSec = arrive.sec ?? depart.sec;
	if (orderSec === null) {
		return { error: `no arrive or depart time at row ${rowNumber}` };
	}
	return {
		direction,
		express:
			cell(record, COLUMNS.express) === EXPRESS_FLAG ? "express" : "local",
		key: `${lineKey}|${serviceDay}|${trainNo}`,
		lineKey,
		serviceDay,
		stop: {
			arrive: arrive.raw,
			code,
			depart: depart.raw,
			name: cell(record, COLUMNS.stationName),
			orderSec,
			tieSec: depart.sec ?? orderSec,
		},
		trainNo,
	};
}

/**
 * 파일은 역사코드 순으로 정렬돼 있으므로 한 열차의 정차를 시각 순으로 다시 세운다.
 * 같은 시각이면 파일 순서를 유지한다(Array.prototype.sort는 안정 정렬).
 */
function toSourceStops(rows: StopRow[]): SourceStop[] {
	const ordered = [...rows].sort(
		(a, b) => a.orderSec - b.orderSec || a.tieSec - b.tieSec
	);
	const seen = new Set<string>();
	return ordered.map((row, index) => {
		const stop: SourceStop = {
			arrive: row.arrive,
			depart: row.depart,
			seq: index + 1,
			station: { code: row.code, name: row.name },
		};
		if (seen.has(row.code)) {
			stop.qualityFlags = [DUPLICATE_STOP_FLAG];
		}
		seen.add(row.code);
		return stop;
	});
}

/**
 * 서울교통공사 시각표 CSV(디코드된 텍스트)를 (호선, 요일, 열차코드)마다 1편으로 묶는다.
 * 머리글을 이름으로 찾고, 알 수 없는 값의 행은 행 번호와 함께 errors에 넣고 버린다.
 */
export function parseSeoulMetroCsv(text: string): {
	trips: SourceTrip[];
	errors: string[];
	header: string[];
} {
	let header: string[] = [];
	const records = parse(text, {
		bom: true,
		columns: (names: string[]) => {
			header = names.map((name) => name.trim());
			return header;
		},
		skip_empty_lines: true,
	}) as CsvRecord[];

	const missing = Object.values(COLUMNS).filter(
		(column) => !header.includes(column)
	);
	if (missing.length > 0) {
		return {
			errors: [`missing header column(s): ${missing.join(", ")}`],
			header,
			trips: [],
		};
	}

	const errors: string[] = [];
	const groups = new Map<string, TripGroup>();
	for (const [index, record] of records.entries()) {
		const rowNumber = index + FIRST_DATA_ROW;
		const row = parseRow(record, rowNumber);
		if ("error" in row) {
			errors.push(row.error);
			continue;
		}
		const group = groups.get(row.key);
		if (!group) {
			const { direction, express, lineKey, serviceDay, trainNo } = row;
			groups.set(row.key, {
				direction,
				express,
				lineKey,
				rows: [row.stop],
				serviceDay,
				trainNo,
			});
			continue;
		}
		if (group.direction !== row.direction || group.express !== row.express) {
			errors.push(
				`direction/express differs within ${row.key} at row ${rowNumber}`
			);
			continue;
		}
		group.rows.push(row.stop);
	}

	const trips = [...groups.values()].map(
		(group): SourceTrip => ({
			direction: group.direction,
			express: group.express,
			lineKey: group.lineKey,
			qualityFlags: [],
			serviceDay: group.serviceDay,
			serviceDaySource: "source",
			source: "seoul-metro-csv",
			stops: toSourceStops(group.rows),
			trainNo: group.trainNo,
		})
	);
	return { errors, header, trips };
}

const FILENAME_PATTERN = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;

/** fetch는 헤더의 바이트를 한 글자씩 돌려준다. 그 바이트가 올바른 UTF-8이면 UTF-8로 다시 읽는다. */
function decodeHeaderBytes(value: string): string {
	const codes = [...value].map((char) => char.charCodeAt(0));
	if (codes.some((code) => code > 0xff)) {
		return value;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(codes)
		);
	} catch {
		return value;
	}
}

/** Content-Disposition의 파일명. 외부 값이므로 경로 부분을 버리고 이름만 남긴다. */
function fileNameFromResponse(response: Response): string {
	const header = response.headers.get("content-disposition");
	const match = header ? FILENAME_PATTERN.exec(header) : null;
	if (!match?.[1]) {
		return FALLBACK_FILE_NAME;
	}
	let name = decodeHeaderBytes(match[1]);
	try {
		name = decodeURIComponent(name);
	} catch {
		// 퍼센트 인코딩이 아니면 그대로 쓴다.
	}
	const safe = basename(name.replaceAll("\\", "/")).trim();
	return safe === "" || safe === "." || safe === ".."
		? FALLBACK_FILE_NAME
		: safe;
}

/** 원본 CSV를 받아 data/raw/seoul-metro-timetable/<원본 파일명>에 그대로 저장한다. */
export async function fetchSeoulMetroCsv(
	dataDir: string,
	url: string = SEOUL_METRO_CSV_URL,
	fetchImpl: typeof fetch = fetch
): Promise<{
	fileName: string;
	path: string;
	sha256: string;
	unchanged: boolean;
}> {
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(
			`Seoul Metro CSV download failed: ${response.status} ${url}`
		);
	}
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("text/html")) {
		throw new Error(
			`Seoul Metro CSV response is not a CSV: content-type=${contentType}, ${url}`
		);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	const fileName = fileNameFromResponse(response);
	const saved = await saveRaw(dataDir, SEOUL_METRO_RAW_SOURCE, fileName, bytes);
	return { fileName, ...saved };
}

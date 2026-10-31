import type {
	ExpressKind,
	ServiceDay,
	TrackDirection,
} from "@Betro/db/schema/transit";
import type { LineKey } from "../lines";
import type { SourceStop, SourceTrip } from "../timetable/model";
import type { KricRow } from "./kric-file";
import { copyAsSaturday } from "./kric-korail-rows";

/**
 * 시각 칸의 배열 방식.
 * - code-dash: "D19-10:17+D18-10:21"(신분당·우이신설·신림). 정차마다 "<순번>-<시각>"을 "+"로 잇는다.
 * - code-plus: "001+06:00+002+06:45"(공항철도). 순번과 시각을 번갈아 "+"로 잇는다.
 */
type TimeLayout = "code-dash" | "code-plus";

interface PackedLine {
	/** 중간역을 건너뛰는 열차를 direct로 본다(공항철도). 파일의 열차번호 체계가 실시간과 같다는 보장이 없어 번호 접두는 쓰지 않는다. */
	directBySkippedStops: boolean;
	lineKey: LineKey;
	/** 운행구간기점명·종점명 후보를 하행 끝에서 상행 끝 순으로. 종점이 기점보다 뒤에 있으면 up. */
	terminalOrder: readonly string[];
	timeLayout: TimeLayout;
}

/**
 * id=900 파일에서 열차 한 편을 한 행에 묶어 담는 노선 중 이 앱이 쓰는 4개 노선.
 * 상행: 신분당=신사 방면, 공항철도=서울역 방면, 우이신설=북한산우이 방면, 신림=샛강 방면.
 * 나머지 묶음 노선(인천1 ",", 의정부 "/" 등)은 범위 밖이라 읽지 않는다.
 */
export const KRIC_PACKED_LINES: Readonly<Record<string, PackedLine>> = {
	"수도권 경량도시철도 신림선": {
		directBySkippedStops: false,
		lineKey: "sillim",
		terminalOrder: ["관악산", "보라매병원", "샛강"],
		timeLayout: "code-dash",
	},
	"수도권 경량도시철도 우이신설선": {
		directBySkippedStops: false,
		lineKey: "ui-sinseol",
		terminalOrder: ["신설동", "북한산우이"],
		timeLayout: "code-dash",
	},
	신분당선: {
		directBySkippedStops: false,
		lineKey: "shinbundang",
		terminalOrder: ["광교", "정자", "판교", "신사"],
		timeLayout: "code-dash",
	},
	인천국제공항선: {
		directBySkippedStops: true,
		lineKey: "airport",
		terminalOrder: ["인천공항2터미널", "검암", "디지털미디어시티", "서울"],
		timeLayout: "code-plus",
	},
};

const SERVICE_DAY_LABELS: Readonly<Record<string, readonly ServiceDay[]>> = {
	공휴일: ["holiday"],
	일요일: ["holiday"],
	"주말+공휴일": ["saturday", "holiday"],
	토요일: ["saturday"],
	"토요일+공휴일": ["saturday", "holiday"],
	"토요일+휴일": ["saturday", "holiday"],
	평일: ["weekday"],
	휴일: ["holiday"],
};

/** 시각 대신 배차 간격 설명만 있는 행(인천2 "운행시격", 에버라인 "운행간격"). */
const HEADWAY_TEXT = /운행시격|운행간격/;
/** "H:MM" 또는 "HH:MM". 신림선 원문에 한 번 있는 오타 ":0:59"처럼 앞에 붙은 ":" 하나는 떼고 읽는다. */
const PACKED_TIME = /^:?(\d{1,2}:\d{2})$/;
/** 빈 시각 표기(우이신설·신림 "001-:", 신분당 "D12-  :"). */
const EMPTY_TIME = ":";

export type PackedSkipReason = "headway-only" | "unknown-format";

export interface KricPackedResult {
	errors: string[];
	skipped: { lineName: string; reason: PackedSkipReason }[];
	/** 노선별 출처 기준일(그 노선 행 중 가장 늦은 데이터기준일자). */
	sourceVersion: Partial<Record<LineKey, string>>;
	trips: SourceTrip[];
}

interface PackedStation {
	code: string;
	name: string;
}

/** "<코드>-<값>"을 첫 "-"에서 가른다. 값(역명)에는 "-"가 들어갈 수 있다. */
function splitDash(token: string): [string, string] | undefined {
	const index = token.indexOf("-");
	if (index <= 0) {
		return;
	}
	return [token.slice(0, index).trim(), token.slice(index + 1).trim()];
}

function parseStations(text: string): PackedStation[] | undefined {
	const stations: PackedStation[] = [];
	for (const token of text.split("+")) {
		const parts = splitDash(token);
		if (!parts || parts[1] === "") {
			return;
		}
		stations.push({ code: parts[0], name: parts[1] });
	}
	return stations;
}

/** 시각 원문을 검사한다. 빈 표기는 null, 형식이 다르면 undefined. */
function packedTime(text: string): string | null | undefined {
	const trimmed = text.trim();
	if (trimmed === EMPTY_TIME || trimmed === "") {
		return null;
	}
	return PACKED_TIME.exec(trimmed)?.[1];
}

/** 시각 칸을 [순번, 시각 원문] 쌍으로 가른다. */
function timePairs(
	text: string,
	layout: TimeLayout
): [string, string][] | undefined {
	const tokens = text.split("+");
	const pairs: [string, string][] = [];
	if (layout === "code-dash") {
		for (const token of tokens) {
			const parts = splitDash(token);
			if (!parts) {
				return;
			}
			pairs.push(parts);
		}
		return pairs;
	}
	if (tokens.length % 2 !== 0) {
		return;
	}
	for (let i = 0; i < tokens.length; i += 2) {
		pairs.push([tokens[i]?.trim() ?? "", tokens[i + 1] ?? ""]);
	}
	return pairs;
}

/**
 * 시각 칸 하나를 역 순서에 맞춘 시각 배열로 바꾼다. 칸이 비면 모두 null(공항철도 도착 칸).
 * 정차 수나 순번이 역 칸과 어긋나거나 시각 형식이 다르면 undefined.
 */
function parseTimes(
	text: string | null,
	layout: TimeLayout,
	stations: PackedStation[]
): (string | null)[] | undefined {
	if (text === null) {
		return stations.map(() => null);
	}
	const pairs = timePairs(text, layout);
	if (!pairs || pairs.length !== stations.length) {
		return;
	}
	const times: (string | null)[] = [];
	for (const [index, [code, time]] of pairs.entries()) {
		const value = packedTime(time);
		if (code !== stations[index]?.code || value === undefined) {
			return;
		}
		times.push(value);
	}
	return times;
}

function parseStops(
	row: KricRow,
	layout: TimeLayout
): SourceStop[] | undefined {
	const stations = parseStations(row.stationName);
	if (!stations) {
		return;
	}
	const arrives = parseTimes(row.arrive, layout, stations);
	const departs = parseTimes(row.depart, layout, stations);
	if (!(arrives && departs)) {
		return;
	}
	const hasTime = [...arrives, ...departs].some((time) => time !== null);
	if (!hasTime) {
		return;
	}
	return stations.map((station, index) => ({
		arrive: arrives[index] ?? null,
		depart: departs[index] ?? null,
		seq: index + 1,
		station: { name: station.name },
	}));
}

function judgeDirection(
	line: PackedLine,
	origin: string,
	destination: string
): TrackDirection | undefined {
	const originIndex = line.terminalOrder.indexOf(origin);
	const destinationIndex = line.terminalOrder.indexOf(destination);
	const known = originIndex !== -1 && destinationIndex !== -1;
	if (!known || originIndex === destinationIndex) {
		return;
	}
	return destinationIndex > originIndex ? "up" : "down";
}

/** 노선에서 가장 많이 서는 열차의 역 순서를 그 노선의 전체 역 순서로 본다. */
function fullStationOrders(trips: SourceTrip[]): Map<LineKey, string[]> {
	const orders = new Map<LineKey, string[]>();
	for (const trip of trips) {
		const current = orders.get(trip.lineKey);
		if (!current || trip.stops.length > current.length) {
			orders.set(
				trip.lineKey,
				trip.stops.map((stop) => stop.station.name ?? "")
			);
		}
	}
	return orders;
}

/** 첫 역과 끝 역 사이의 전체 역 수보다 정차가 적으면 중간역을 건너뛴 것이다. */
function skipsStops(trip: SourceTrip, order: string[]): boolean {
	const first = order.indexOf(trip.stops[0]?.station.name ?? "");
	const last = order.indexOf(trip.stops.at(-1)?.station.name ?? "");
	if (first === -1 || last === -1) {
		return false;
	}
	return trip.stops.length < Math.abs(last - first) + 1;
}

function markDirectTrips(trips: SourceTrip[]): SourceTrip[] {
	const directLines = new Set(
		Object.values(KRIC_PACKED_LINES)
			.filter((line) => line.directBySkippedStops)
			.map((line) => line.lineKey)
	);
	const orders = fullStationOrders(
		trips.filter((trip) => directLines.has(trip.lineKey))
	);
	return trips.map((trip) => {
		const order = orders.get(trip.lineKey);
		if (!(order && skipsStops(trip, order))) {
			return trip;
		}
		const express: ExpressKind = "direct";
		return { ...trip, express };
	});
}

function withSaturdayCopies(trips: SourceTrip[]): SourceTrip[] {
	const linesWithSaturday = new Set(
		trips.filter((t) => t.serviceDay === "saturday").map((t) => t.lineKey)
	);
	const copies = trips
		.filter(
			(t) => t.serviceDay === "holiday" && !linesWithSaturday.has(t.lineKey)
		)
		.map(copyAsSaturday);
	return [...trips, ...copies];
}

type RowOutcome =
	| { error: string }
	| { skip: PackedSkipReason }
	| { trips: SourceTrip[] };

/** 대상 노선의 행 하나를 요일마다 trip으로 바꾼다. */
function rowToTrips(row: KricRow, line: PackedLine): RowOutcome {
	const serviceDays = SERVICE_DAY_LABELS[row.dayLabel];
	if (!serviceDays) {
		return { error: `unknown 요일구분 "${row.dayLabel}" in ${row.lineName}` };
	}
	const stops = parseStops(row, line.timeLayout);
	if (!stops) {
		return { skip: "unknown-format" };
	}
	const direction = judgeDirection(line, row.origin, row.destination);
	if (!direction) {
		return {
			error: `direction-unknown ${line.lineKey} ${row.dayLabel} ${row.trainNo} (${row.origin}->${row.destination})`,
		};
	}
	return {
		trips: serviceDays.map((serviceDay) => ({
			direction,
			express: "local",
			lineKey: line.lineKey,
			qualityFlags: [],
			serviceDay,
			serviceDaySource: "source",
			source: "kric-packed",
			sourceVersion: row.dataDate === "" ? undefined : row.dataDate,
			stops: stops.map((stop) => ({ ...stop, station: { ...stop.station } })),
			trainNo: row.trainNo,
		})),
	};
}

/**
 * KRIC id=900 파일의 묶음 문자열 노선(신분당·공항철도·우이신설·신림)을 공통 SourceTrip으로 바꾼다.
 * 한 행이 열차 1편이다. 역은 이름으로만 준다(파일의 코드는 열차 안 순번이거나 운영사 역번호다).
 * 파일에 방향 칸이 없어 기점·종점 순서로 방향을 정한다. 묶음 요일("토요일+휴일")은 요일마다 trip을 만든다.
 * 시각 대신 배차 간격만 있는 노선은 headway-only, 대상 노선인데 형식이 다른 행은 unknown-format으로 skipped에 넣는다.
 */
export function parseKricPacked(rows: KricRow[]): KricPackedResult {
	const errors = new Set<string>();
	const skipped = new Map<string, KricPackedResult["skipped"][number]>();
	const sourceVersion: Partial<Record<LineKey, string>> = {};
	const trips: SourceTrip[] = [];
	const skip = (lineName: string, reason: PackedSkipReason) => {
		skipped.set(`${lineName}|${reason}`, { lineName, reason });
	};

	for (const row of rows) {
		if (HEADWAY_TEXT.test(`${row.arrive ?? ""} ${row.depart ?? ""}`)) {
			skip(row.lineName, "headway-only");
			continue;
		}
		const line = KRIC_PACKED_LINES[row.lineName];
		if (!line) {
			continue;
		}
		const outcome = rowToTrips(row, line);
		if ("error" in outcome) {
			errors.add(outcome.error);
			continue;
		}
		if ("skip" in outcome) {
			skip(row.lineName, outcome.skip);
			continue;
		}
		trips.push(...outcome.trips);
		if (row.dataDate > (sourceVersion[line.lineKey] ?? "")) {
			sourceVersion[line.lineKey] = row.dataDate;
		}
	}

	return {
		errors: [...errors],
		skipped: [...skipped.values()],
		sourceVersion,
		trips: withSaturdayCopies(markDirectTrips(trips)),
	};
}

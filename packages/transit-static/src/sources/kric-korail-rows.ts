import type {
	ExpressKind,
	ServiceDay,
	TrackDirection,
} from "@Betro/db/schema/transit";
import type { LineKey } from "../lines";
import type { SourceStop, SourceTrip } from "../timetable/model";
import type { KricRow } from "./kric-file";

/** 파일의 코레일 행 형식 노선명 → lineKey. 파일의 나머지 노선은 묶음 문자열 쪽(Task 6)이거나 서울 밖이다. */
export const KRIC_LINE_NAMES: Readonly<Record<string, LineKey>> = {
	경강선: "gyeonggang",
	경의중앙선: "gyeongui-jungang",
	경춘선: "gyeongchun",
	서해선: "seohae",
	수인분당선: "suin-bundang",
};

/**
 * 노선별 기점·종점 후보를 하행 끝에서 상행 끝 순으로 늘어놓은 순서.
 * 상행 기준은 osm-routes.json과 같다(경의중앙=문산 방면, 수인분당·경춘=청량리 방면, 경강=판교 방면, 서해=일산 방면).
 * 종착역만 보면 임진강→문산처럼 같은 상행 쪽 두 역 사이의 열차를 가를 수 없어, 기점과 종점의 순서를 비교한다.
 */
export const KORAIL_STATION_ORDER: Readonly<Record<string, readonly string[]>> =
	{
		gyeongchun: ["춘천", "마석", "평내호", "상봉", "청량리", "광운대"],
		gyeonggang: ["여주", "부발", "신판교"],
		"gyeongui-jungang": [
			"지평",
			"용문",
			"팔당",
			"덕소",
			"청량리",
			"용산",
			"서울",
			"수색",
			"능곡",
			"대곡",
			"일산",
			"문산",
			"임진강",
		],
		seohae: ["원시", "대곡", "일산"],
		"suin-bundang": ["신인천", "오이도", "고색", "죽전", "왕십리", "청량리"],
	};

const SERVICE_DAY_LABELS: Readonly<Record<string, ServiceDay>> = {
	공휴일: "holiday",
	일요일: "holiday",
	토요일: "saturday",
	평일: "weekday",
	휴일: "holiday",
};

const EXPRESS_LABELS: Readonly<Record<string, ExpressKind>> = {
	급행: "express",
	직통: "direct",
};

interface DirectionResult {
	direction?: TrackDirection;
	reason?: string;
}

function judgeDirection(
	lineKey: LineKey,
	origin: string,
	destination: string
): DirectionResult {
	const order = KORAIL_STATION_ORDER[lineKey] ?? [];
	const originIndex = order.indexOf(origin);
	const destinationIndex = order.indexOf(destination);
	if (originIndex === -1 || destinationIndex === -1) {
		return { reason: `${origin}->${destination}` };
	}
	if (originIndex === destinationIndex) {
		return { reason: `${origin}->${destination}` };
	}
	return { direction: destinationIndex > originIndex ? "up" : "down" };
}

interface TripGroup {
	dataDate: string;
	destination: string;
	express: ExpressKind;
	firstLabel: string;
	lineKey: LineKey;
	origin: string;
	rows: KricRow[];
	serviceDay: ServiceDay;
	trainNo: string;
}

function toStops(rows: KricRow[]): SourceStop[] {
	return rows.map((row, index) => ({
		arrive: row.arrive,
		depart: row.depart,
		seq: index + 1,
		station: { name: row.stationName },
	}));
}

function copyAsSaturday(trip: SourceTrip): SourceTrip {
	return {
		...trip,
		qualityFlags: [...trip.qualityFlags],
		serviceDay: "saturday",
		serviceDaySource: "holiday-copied",
		stops: trip.stops.map((stop) => ({
			...stop,
			station: { ...stop.station },
		})),
	};
}

/**
 * KRIC 파일 중 코레일 행 형식 5개 노선(경의중앙·수인분당·경춘·서해·경강)을 공통 SourceTrip으로 바꾼다.
 * 한 열차 = (노선, 요일, 열차번호, 기점, 종점). 파일 순서가 곧 정차 순서다.
 * 방향을 못 정하는 열차와 모르는 요일 표기는 errors에 넣고 trip으로 만들지 않는다.
 */
export function parseKricKorailRows(rows: KricRow[]): {
	trips: SourceTrip[];
	errors: string[];
	sourceVersion: string;
} {
	const errors: string[] = [];
	const reportedLabels = new Set<string>();
	const groups = new Map<string, TripGroup>();
	let sourceVersion = "";
	for (const row of rows) {
		const lineKey = KRIC_LINE_NAMES[row.lineName];
		if (!lineKey) {
			continue;
		}
		const serviceDay = SERVICE_DAY_LABELS[row.dayLabel];
		if (!serviceDay) {
			const label = `${row.lineName}|${row.dayLabel}`;
			if (!reportedLabels.has(label)) {
				reportedLabels.add(label);
				errors.push(`unknown 요일구분 "${row.dayLabel}" in ${row.lineName}`);
			}
			continue;
		}
		if (row.dataDate > sourceVersion) {
			sourceVersion = row.dataDate;
		}
		const key = [
			lineKey,
			serviceDay,
			row.dayLabel,
			row.trainNo,
			row.origin,
			row.destination,
		].join("|");
		const group = groups.get(key);
		if (group) {
			group.rows.push(row);
			continue;
		}
		groups.set(key, {
			dataDate: row.dataDate,
			destination: row.destination,
			express: EXPRESS_LABELS[row.serviceType] ?? "local",
			firstLabel: row.dayLabel,
			lineKey,
			origin: row.origin,
			rows: [row],
			serviceDay,
			trainNo: row.trainNo,
		});
	}

	const trips: SourceTrip[] = [];
	for (const group of groups.values()) {
		const { direction, reason } = judgeDirection(
			group.lineKey,
			group.origin,
			group.destination
		);
		if (!direction) {
			errors.push(
				`direction-unknown ${group.lineKey} ${group.firstLabel} ${group.trainNo} (${reason})`
			);
			continue;
		}
		trips.push({
			direction,
			express: group.express,
			lineKey: group.lineKey,
			qualityFlags: [],
			serviceDay: group.serviceDay,
			serviceDaySource: "source",
			source: "kric-korail",
			sourceVersion: group.dataDate === "" ? undefined : group.dataDate,
			stops: toStops(group.rows),
			trainNo: group.trainNo,
		});
	}

	const linesWithSaturday = new Set(
		trips.filter((t) => t.serviceDay === "saturday").map((t) => t.lineKey)
	);
	const copies = trips
		.filter(
			(t) => t.serviceDay === "holiday" && !linesWithSaturday.has(t.lineKey)
		)
		.map(copyAsSaturday);
	return { errors, sourceVersion, trips: [...trips, ...copies] };
}

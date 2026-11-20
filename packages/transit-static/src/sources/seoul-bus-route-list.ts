type RawItem = Record<string, unknown>;

export interface BusRouteListRow {
	busRouteId: string;
	/** 첫차 시각. 그 날 0시부터의 분. 형식이 다르면 null. */
	firstBusMinute: number | null;
	/** 배차간격(분, `term`). 비었거나 0 이하면 null. */
	headwayMin: number | null;
	/** 막차 시각. 그 날 0시부터의 분. 자정을 넘는 막차도 그 값 그대로다. 형식이 다르면 null. */
	lastBusMinute: number | null;
	name: string;
	routeType: string;
	/** 지역을 뗀 이름(`busRouteAbrv`). 비어 있으면 `name`. */
	shortName: string;
}

/** 한 글자 검색이 된다(계획 확인 사실). 숫자 10개에 영문·한글 보충 검색어를 더한다. */
export const ROUTE_LIST_SEARCH_TERMS: readonly string[] = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"M",
	"N",
	"G",
	"A",
	"마을",
	"순환",
];

function text(value: unknown): string {
	return value === null || value === undefined ? "" : String(value).trim();
}

const BUS_TIME_PATTERN = /^\d{8}(\d{2})(\d{2})\d{2}$/;
const MINUTES_PER_HOUR = 60;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;

/** `yyyyMMddHHmmss`의 HHmm을 0시부터의 분으로 바꾼다. 형식이 다르면 null. */
function busTimeMinute(value: unknown): number | null {
	const match = BUS_TIME_PATTERN.exec(text(value));
	if (!match) {
		return null;
	}
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > MAX_HOUR || minute > MAX_MINUTE) {
		return null;
	}
	return hour * MINUTES_PER_HOUR + minute;
}

function headwayMinutes(value: unknown): number | null {
	const parsed = Number(text(value));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseBusRouteList(items: RawItem[]): BusRouteListRow[] {
	const rows: BusRouteListRow[] = [];
	for (const item of items) {
		const busRouteId = text(item.busRouteId);
		if (busRouteId === "") {
			continue;
		}
		const name = text(item.busRouteNm);
		const abrv = text(item.busRouteAbrv);
		rows.push({
			busRouteId,
			firstBusMinute: busTimeMinute(item.firstBusTm),
			headwayMin: headwayMinutes(item.term),
			lastBusMinute: busTimeMinute(item.lastBusTm),
			name,
			routeType: text(item.routeType),
			shortName: abrv === "" ? name : abrv,
		});
	}
	return rows;
}

/** `busRouteId`로 합치고 ID 순으로 정렬한다. 같은 ID는 먼저 나온 것을 남긴다. */
export function mergeRouteLists(pages: BusRouteListRow[][]): BusRouteListRow[] {
	const byId = new Map<string, BusRouteListRow>();
	for (const page of pages) {
		for (const row of page) {
			if (!byId.has(row.busRouteId)) {
				byId.set(row.busRouteId, row);
			}
		}
	}
	return [...byId.values()].sort((a, b) =>
		a.busRouteId < b.busRouteId ? -1 : Number(a.busRouteId > b.busRouteId)
	);
}

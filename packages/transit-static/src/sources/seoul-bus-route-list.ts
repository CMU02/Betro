type RawItem = Record<string, unknown>;

export interface BusRouteListRow {
	busRouteId: string;
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

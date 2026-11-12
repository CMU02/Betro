import type { BusRouteListEntry } from "../sources/bus-route-xlsx";
import type { BusRouteListRow } from "../sources/seoul-bus-route-list";

/**
 * 수집·적재에서 빼는 getStaionByRoute.routeType 값.
 * - 1: 공항버스 (한정면허, 서울시 시내버스 396에 없음. 6001-6020, 6100-6705A, N6000/N6002/N6701/N6703, 38개).
 * - 9: 폐지. 2026-09 데이터에는 없다. 가드로 남긴다.
 * - 10: 관광·연계 셔틀 (마포순환열차버스 113000006, 한강마곡 103000003, 한강잠실 103000005).
 * - 14: 한강버스 (선박. 정류소가 선착장, ARS 00001-00008).
 * 그 밖의 값은 범위 안이다: 2(마을), 3, 4, 5, 6, 7(인천), 8(경기), 15(심야 N버스), 가이드에 없는 값(예: 0). 보고서가 센다.
 * 마을(2)은 서울 시내버스와 똑같이, 인천(7)·경기(8)는 출퇴근 등록과 세션에만 쓴다(스펙 3장 "버스 범위", MVP 2-D).
 *
 * 3단계 범위 대조(2026-09 OA-1095 + getStaionByRoute 718개, 마을 제외 시절):
 * - 유형으로 거르면 427개 노선 ID(3: 152, 4: 242, 5: 5, 6: 13, 15: 15).
 * - 427 = 서울시 시내버스 396노선의 416개 ID + 자율주행 시범버스 11개(AUTONOMOUS_PILOT_ROUTES).
 * - 416 − 출근/퇴근으로 나뉜 14개 ID(서울01-10, 8442, 8762, 8773, 8775) − A/B 분기 6개 ID
 *   (110A/B, 702A/B, 750A/B, 5522A/B, 6640A/B, 7013A/B, 추정) = 396 노선
 *   (간선 134, 지선 210, 광역 10, 맞춤 26, 순환 2, 심야 14).
 * 노선 ID는 DB에서 합치지 않는다. ID마다 정류소와 모양이 따로 있다.
 */
export const OUT_OF_SCOPE_ROUTE_TYPES: readonly string[] = [
	"1",
	"9",
	"10",
	"14",
];

/**
 * 서울을 오가는 인천(7)·경기(8) 면허 노선. 노선 엑셀(OA-1095)에 없어 getBusRouteList 목록에서 더하고,
 * 지도용 상시 관측에서 뺀다(출퇴근 세션에서만 관측).
 */
export const REGIONAL_ROUTE_TYPES: readonly string[] = ["7", "8"];

/** 서울시 공표 마을버스 노선 수(`docs/research/2026-10-30-data-sources.md`). routeType 2와 대조한다. */
export const PUBLISHED_VILLAGE_ROUTE_COUNT = 253;
/** 서울시 공표 서울을 오가는 경기·인천 면허 노선 수(같은 문서). routeType 7·8과 대조한다. */
export const PUBLISHED_REGIONAL_ROUTE_COUNT = 645;
/** 공표 수치 대조 허용 폭(±10%, 계획 Task 3 Step 1). */
export const PUBLISHED_COUNT_TOLERANCE = 0.1;
const PERCENT = 100;

/** 공표 수치의 ±10% 안에 드는 정수 범위. 645 → 581–709. */
export function publishedCountBand(published: number): {
	max: number;
	min: number;
} {
	return {
		max: Math.floor(published * (1 + PUBLISHED_COUNT_TOLERANCE)),
		min: Math.ceil(published * (1 - PUBLISHED_COUNT_TOLERANCE)),
	};
}

/** 개수가 공표 수치의 ±10% 안이면 "범위 안", 아니면 "범위 밖". */
export function publishedCountVerdict(
	count: number,
	published: number
): "범위 안" | "범위 밖" {
	const { max, min } = publishedCountBand(published);
	return count >= min && count <= max ? "범위 안" : "범위 밖";
}

/** 개수를 공표 수치와 대조한 한 줄 요약. 예: "600 (공표 645, ±10% 581–709, 범위 안)". */
export function comparePublishedCount(
	count: number,
	published: number
): string {
	const { max, min } = publishedCountBand(published);
	const verdict = publishedCountVerdict(count, published);
	const tolerance = Math.round(PUBLISHED_COUNT_TOLERANCE * PERCENT);
	return `${count} (공표 ${published}, ±${tolerance}% ${min}–${max}, ${verdict})`;
}

export type BusRegion = "seoul" | "gyeonggi" | "incheon";

/** routeType으로 노선 면허 지역을 정한다. 7 → incheon, 8 → gyeonggi, 그 밖(마을 2 포함) → seoul. */
export function regionOf(routeType: string): BusRegion {
	switch (routeType.trim()) {
		case "7":
			return "incheon";
		case "8":
			return "gyeonggi";
		default:
			return "seoul";
	}
}

/** 지도용 상시 관측 대상인 유형인지. 인천·경기 노선(7·8)은 출퇴근 세션에서만 관측하므로 false. */
export function isMapObservedRouteType(routeType: string): boolean {
	return !REGIONAL_ROUTE_TYPES.includes(routeType.trim());
}

/**
 * 수집·조립이 읽는 노선 항목. 엑셀(OA-1095) 노선은 maxSeq·stopCount가 있고,
 * 노선 목록(getBusRouteList)에서만 온 인천·경기 노선은 없다.
 */
export interface BusRouteEntry {
	/** 엑셀 노선의 가장 큰 순번. 엑셀에 없는 노선은 없다. */
	maxSeq?: number;
	routeId: string;
	routeName: string;
	/** 노선 목록의 routeType. 정류소 원본을 읽지 못한 노선의 지역을 정할 때만 쓴다. */
	routeType?: string;
	/** 지역을 뗀 이름(노선 목록의 busRouteAbrv). 목록에 없으면 routeName을 쓴다. */
	shortName?: string;
	/** 엑셀 행 수. 엑셀에 없는 노선은 없다. */
	stopCount?: number;
}

/**
 * 노선 ID 출처: 엑셀의 노선 ∪ 노선 목록에서 routeType 7·8인 노선.
 * 목록에 있는 노선은 목록의 shortName을 붙인다. 엑셀 노선이 먼저, 더한 노선은 ID 순이다.
 */
export function withRegionalRoutes(
	xlsxRoutes: readonly BusRouteListEntry[],
	list: readonly BusRouteListRow[]
): BusRouteEntry[] {
	const listed = new Map(list.map((row) => [row.busRouteId, row]));
	const entries: BusRouteEntry[] = xlsxRoutes.map((entry) => {
		const row = listed.get(entry.routeId);
		return row ? { ...entry, shortName: row.shortName } : { ...entry };
	});
	const known = new Set(xlsxRoutes.map((entry) => entry.routeId));
	const regional = list
		.filter((row) => REGIONAL_ROUTE_TYPES.includes(row.routeType.trim()))
		.toSorted((a, b) =>
			a.busRouteId < b.busRouteId ? -1 : Number(a.busRouteId > b.busRouteId)
		);
	for (const row of regional) {
		if (known.has(row.busRouteId)) {
			continue;
		}
		known.add(row.busRouteId);
		entries.push({
			routeId: row.busRouteId,
			routeName: row.name,
			routeType: row.routeType,
			shortName: row.shortName,
		});
	}
	return entries;
}

/** OUT_OF_SCOPE_ROUTE_IDS로 뺀 노선에 보고서가 붙이는 사유(자율주행 시범버스를 뺄 때의 문구). */
export const OUT_OF_SCOPE_ROUTE_ID_REASON =
	"자율주행 시범버스: 서울시 시내버스 396노선(2026-01)에 들지 않고 routeType 3·5·15로 와서 유형으로 못 거름";

/**
 * 자율주행 시범버스 노선(routeId → 노선명). 서울시 시내버스 396노선(2026-01)에 들지 않고, 보통 유형(3·5·15)으로 와서
 * routeType으로는 못 거른다. 실제 승객을 태우는 노선이 있어 2026-11-02 제품 결정으로 범위에 넣는다(조립 결과도 깨끗함, 10개는 경고 없음).
 * 다시 빼려면 OUT_OF_SCOPE_ROUTE_IDS를 이 목록으로 바꾸고 BUS_ROUTE_LOGIC_VERSION을 올린 뒤 build:bus-routes를 다시 돌린다.
 */
export const AUTONOMOUS_PILOT_ROUTES: ReadonlyMap<string, string> = new Map([
	["100000020", "청와대A01"],
	["100000024", "새벽A160"],
	["100000025", "동대문A01"],
	["100000026", "청계A01"],
	["100000027", "서대문A01"],
	["100000028", "새벽A741"],
	["101000005", "심야A21"],
	["101000006", "상암A21"],
	["101000009", "새벽A148"],
	["101000010", "새벽A504"],
	["101900003", "동작A01"],
]);

/**
 * routeType으로 거를 수 없어 ID로 빼는 노선(routeId → 노선명 표시용). 지금은 비어 있다.
 * 자율주행 시범버스를 다시 빼려면 `= AUTONOMOUS_PILOT_ROUTES`로 바꾼다.
 */
export const OUT_OF_SCOPE_ROUTE_IDS: ReadonlyMap<string, string> = new Map();

/**
 * 자율주행 시범버스 노선명 패턴(한글 지명 + A + 숫자). 2026-09 데이터 718개 중 정확히 AUTONOMOUS_PILOT_ROUTES 11개만 맞고
 * 110A고려대, 5522A난곡, 01A, 2312B는 맞지 않는다. 보고서 검토용이며 범위 판정에는 쓰지 않는다.
 */
export const AUTONOMOUS_ROUTE_NAME = /^[가-힣]+A\d+$/;

export function isInScopeRouteType(routeType: string): boolean {
	return !OUT_OF_SCOPE_ROUTE_TYPES.includes(routeType.trim());
}

/** excludedRouteIds는 테스트나 일회성 실행에서 다른 제외 목록을 쓰려고 둔다. 기본값은 OUT_OF_SCOPE_ROUTE_IDS. */
export function isInScopeRouteId(
	routeId: string,
	excludedRouteIds: ReadonlyMap<string, string> = OUT_OF_SCOPE_ROUTE_IDS
): boolean {
	return !excludedRouteIds.has(routeId.trim());
}

/** 수집(fetch-bus-routes)과 조립(assemble)이 같은 규칙으로 범위를 정한다. */
export function isInScopeRoute(
	routeId: string,
	routeType: string,
	excludedRouteIds: ReadonlyMap<string, string> = OUT_OF_SCOPE_ROUTE_IDS
): boolean {
	return (
		isInScopeRouteType(routeType) && isInScopeRouteId(routeId, excludedRouteIds)
	);
}

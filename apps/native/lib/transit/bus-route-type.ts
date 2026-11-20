/**
 * 버스 노선 종류. 서울 routeType(1~8)과 GBIS 노선유형 코드(11~30)는 값이 겹치지 않아 한 표로 본다.
 * 인천 TAGO의 routetp는 한글 이름이 그대로 오므로, 소스에 한글을 두지 않으려고 유니코드 이스케이프로 적는다.
 */
export type BusKind =
	| "airport"
	| "branch"
	| "circular"
	| "direct"
	| "express"
	| "general"
	| "seat"
	| "trunk"
	| "village"
	| "wide";

const BUS_KIND_BY_ROUTE_TYPE: Record<string, BusKind> = {
	// 간선버스
	"\uAC04\uC120\uBC84\uC2A4": "trunk",
	// 인천 TAGO: 공항버스
	"\uACF5\uD56D\uBC84\uC2A4": "airport",
	// 광역버스
	"\uAD11\uC5ED\uBC84\uC2A4": "express",
	// 급행버스
	"\uAE09\uD589\uBC84\uC2A4": "express",
	// 마을버스
	"\uB9C8\uC744\uBC84\uC2A4": "village",
	// 지선버스
	"\uC9C0\uC120\uBC84\uC2A4": "branch",
	// 순환버스
	"\uC21C\uD658\uBC84\uC2A4": "circular",
	// 좌석버스
	"\uC88C\uC11D\uBC84\uC2A4": "seat",
	// 서울
	"1": "airport",
	"2": "village",
	"3": "trunk",
	"4": "branch",
	"5": "circular",
	"6": "express",
	// 경기 GBIS 노선유형(시외·고속·공항 41~53은 적재하지 않는다)
	"11": "direct",
	"12": "seat",
	"13": "general",
	"14": "wide",
	"15": "general",
	"16": "circular",
	"21": "direct",
	"22": "seat",
	"23": "general",
	"30": "village",
};

/** 모르는 종류(서울 7·8, 새 코드)는 null이다. 부제는 종류 없이, 배지는 기본 색으로 그린다. */
export function busKindOf(routeType: string): BusKind | null {
	return BUS_KIND_BY_ROUTE_TYPE[routeType.trim()] ?? null;
}

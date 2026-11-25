import type { Leg, Route } from "@Betro/commute/plan";

import { visibleLegs } from "./leg-vehicles";

const SEOUL_BUS_PREFIX = "seoul-bus:";
/** 실시간 연결이 없는 출처의 노선 접두사(5-B 전까지). */
const NO_LIVE_PREFIXES = ["gbis:", "tago:"] as const;

export interface MapLegFlags {
	leg: Leg;
	/** 이 노선에 실시간 정보가 연결되어 있는가. 없으면 차량도 관측 요청도 없다. */
	realtime: boolean;
	showVehicles: boolean;
}

/** 경기(GBIS)·인천(TAGO) 노선은 선과 정류장만 있고 실시간 정보가 없다. */
export function hasLiveData(line: string): boolean {
	return !NO_LIVE_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/** 숨김 설정에 실시간 유무를 더한다. 실시간이 없는 구간은 숨기지 않아도 차량을 그리지 않는다. */
export function mapLegFlags(
	route: Route,
	hiddenMapLines: readonly string[]
): MapLegFlags[] {
	return visibleLegs(route, hiddenMapLines).map(({ leg, showVehicles }) => {
		const realtime = hasLiveData(leg.line);
		return { leg, realtime, showVehicles: showVehicles && realtime };
	});
}

/** 관측 요청(하트비트)에 보낼 노선. 서울 버스만 보낸다. */
export function watchRefsOf(route: Route): string[] {
	const refs = route.legs
		.filter(
			(leg) => leg.mode === "bus" && leg.line.startsWith(SEOUL_BUS_PREFIX)
		)
		.map((leg) => leg.line);
	return [...new Set(refs)];
}

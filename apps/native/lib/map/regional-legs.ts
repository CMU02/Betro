import type { Leg, Route } from "@Betro/commute/plan";

import { visibleLegs } from "./leg-vehicles";

type RegionalSource = "gbis" | "tago";

/** 지도가 실시간을 보는 버스 출처 접두사. 서울·경기·인천 모두 수집기가 부른다. */
const WATCHED_BUS_PREFIXES = ["seoul-bus:", "gbis:", "tago:"] as const;

export interface MapLegFlags {
	leg: Leg;
	/** 이 노선에 실시간 정보가 연결되어 있는가. 없으면 차량도 관측 요청도 없다. */
	realtime: boolean;
	showVehicles: boolean;
}

/** 그날 멈춘 출처의 노선만 실시간이 없다. 서울 버스와 지하철은 늘 있다. */
export function hasLiveData(
	line: string,
	stoppedSources: readonly RegionalSource[]
): boolean {
	return !stoppedSources.some((source) => line.startsWith(`${source}:`));
}

/** 숨김 설정에 실시간 유무를 더한다. 실시간이 없는 구간은 숨기지 않아도 차량을 그리지 않는다. */
export function mapLegFlags(
	route: Route,
	hiddenMapLines: readonly string[],
	stoppedSources: readonly RegionalSource[]
): MapLegFlags[] {
	return visibleLegs(route, hiddenMapLines).map(({ leg, showVehicles }) => {
		const realtime = hasLiveData(leg.line, stoppedSources);
		return { leg, realtime, showVehicles: showVehicles && realtime };
	});
}

/** 관측 요청(하트비트)에 보낼 노선. 서울·경기·인천 버스를 보낸다. */
export function watchRefsOf(route: Route): string[] {
	const refs = route.legs
		.filter(
			(leg) =>
				leg.mode === "bus" &&
				WATCHED_BUS_PREFIXES.some((prefix) => leg.line.startsWith(prefix))
		)
		.map((leg) => leg.line);
	return [...new Set(refs)];
}

/**
 * 스냅샷을 받을 종류. 멈춘 출처와 무관하게 숨기지 않은 구간이 있으면 받는다.
 * 멈춘 출처의 구간만 남은 경로도 버스 스냅샷을 계속 받아야, 자정에 멈춤이 풀린 걸 앱이 안다.
 */
export function snapshotKinds(
	route: Route,
	hiddenMapLines: readonly string[]
): ("bus" | "subway")[] {
	const wanted = new Set<"bus" | "subway">();
	for (const { leg, showVehicles } of visibleLegs(route, hiddenMapLines)) {
		if (showVehicles) {
			wanted.add(leg.mode);
		}
	}
	return [...wanted].sort((a, b) => a.localeCompare(b));
}

import type { BusSnapshot, SubwaySnapshot } from "./map-client";

/**
 * 실시간이 이만큼 넘게 비어 오면 시간표 추정 모드로 본다(14). `dev` ALL 간격(80초)의 두 배보다
 * 길어서, 응답이 한두 번 비었다고 표시가 깜빡이지 않는다.
 */
export const ESTIMATED_MODE_AFTER_MS = 180_000;

/** 종류별 시간표 추정 모드. 버스만 추정이면 지하철 차량은 그대로 그린다. */
export interface EstimatedMode {
	bus: boolean;
	subway: boolean;
}

const longStale = (since: number | null | undefined, now: number): boolean =>
	since !== null &&
	since !== undefined &&
	now - since > ESTIMATED_MODE_AFTER_MS;

/**
 * 지금 시간표 추정 모드인가.
 * - 지하철: 그날 멈췄거나(`stoppedToday`) 스냅샷이 3분 넘게 비어 왔다.
 * - 버스: 그날 멈췄거나, 지도가 보는 노선 중 하나가 3분 넘게 비어 왔다. 스냅샷 전체 `staleSince`는
 *   보지 않는다. 운행이 끝난 노선이나 지역 노선도 들어간 값이라서다(출시 준비 설계 결정 1).
 *
 * `busRouteIds`는 지도가 보는 서울 버스 노선의 맨 ID(`vehicleRouteKey`)다.
 */
export function estimatedModeOf(input: {
	bus: BusSnapshot | null;
	busRouteIds: readonly string[];
	now: number;
	subway: SubwaySnapshot | null;
}): EstimatedMode {
	const { bus, busRouteIds, now, subway } = input;
	const subwayMode =
		subway !== null &&
		(subway.stoppedToday || longStale(subway.staleSince, now));
	const busMode =
		bus !== null &&
		(bus.stoppedToday ||
			busRouteIds.some((routeId) => longStale(bus.staleRoutes[routeId], now)));
	return { bus: busMode, subway: subwayMode };
}

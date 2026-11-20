import type { Route } from "@Betro/commute/plan";

import type { CommuteStage } from "../commute/content-state";
import type { SessionRouteView } from "../commute/session-client";
import type { RouteView } from "./map-client";

const MS_PER_SECOND = 1000;
const BEFORE_BOARDING: readonly CommuteStage[] = ["walk", "wait"];

/**
 * 세션 응답의 경로 예상을 경로 보기와 같은 모양으로 바꾼다. 세션은 지금 구간(기본 경로) 또는 첫 구간(대안)만 안다.
 * 시트의 남은 분이 잠금화면과 같은 숫자가 되도록, 아직 타기 전이면 세션이 고른 차량을 승차 도착판에 올린다
 * (지도 설계 4.6). 세션은 방법을 주지 않으므로 실시간이면 `official`, 추정이면 `timetable`로 둔다.
 */
export function viewFromSession(
	route: Route,
	sessionRoute: SessionRouteView,
	content: { legIndex: number; stage: CommuteStage }
): RouteView {
	const knownIndex = route.rank === 0 ? content.legIndex : 0;
	const beforeBoarding =
		route.rank !== 0 || BEFORE_BOARDING.includes(content.stage);
	const method = sessionRoute.etaState === "live" ? "official" : "timetable";
	const boardEtaAt =
		sessionRoute.boardEtaEpoch === null
			? null
			: sessionRoute.boardEtaEpoch * MS_PER_SECOND;
	return {
		destinationEtaAt:
			sessionRoute.destinationEtaEpoch === null
				? null
				: sessionRoute.destinationEtaEpoch * MS_PER_SECOND,
		legs: route.legs.map((_, index) => {
			const known = index === knownIndex;
			const vehicleId = sessionRoute.legVehicleIds[index] ?? null;
			const onBoard =
				known && beforeBoarding && vehicleId !== null && boardEtaAt !== null;
			return {
				approaching: onBoard
					? [
							{
								etaAt: boardEtaAt,
								method,
								stopsAway: sessionRoute.stopsAway,
								vehicleId,
							},
						]
					: [],
				boardEtaAt: known ? boardEtaAt : null,
				etaState: known ? sessionRoute.etaState : "estimated",
				method: known ? method : null,
				positionState: known ? sessionRoute.positionState : "none",
				vehicleId,
			};
		}),
	};
}

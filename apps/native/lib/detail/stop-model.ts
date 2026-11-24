import { scheduledHeadwayMs } from "@Betro/commute/sources/bus-schedule";

import { t } from "@/lib/i18n/t";
import { type EtaStatus, headwayStatus } from "@/lib/transit/eta-status";
import type { StopRoutes } from "./detail-client";

/** `status`가 null이면 배차 정보가 없는 노선이다. 행에는 번호와 방면만 그린다. */
export interface StopRouteRow {
	directionLabel: string | null;
	href: string;
	line: string;
	routeType: string;
	shortName: string;
	status: EtaStatus | null;
}

/**
 * 정류장을 지나는 노선마다 정적 배차간격 칸을 만든다(상류 호출 없음).
 * 배차간격을 모르면(null·0 이하) `scheduledHeadwayMs`가 null을 돌려 달리는 노선이 "운행 종료"로
 * 보이므로, 그 함수를 부르지 않고 status를 null로 둔다.
 */
export function stopModel(routes: StopRoutes, now: number): StopRouteRow[] {
	return routes.routes.map((route) => {
		const hasHeadway = route.headwayMin !== null && route.headwayMin > 0;
		const headwayMs = hasHeadway
			? scheduledHeadwayMs(
					{
						firstBusMinute: route.firstBusMinute,
						headwayMin: route.headwayMin as number,
						lastBusMinute: route.lastBusMinute,
					},
					now,
					routes.timezone
				)
			: null;
		return {
			directionLabel:
				route.directionName === null
					? null
					: t("stopDetail.direction", { name: route.directionName }),
			href: `/bus/${encodeURIComponent(route.line)}?stop=${route.seq}`,
			line: route.line,
			routeType: route.routeType,
			shortName: route.shortName,
			status: hasHeadway ? headwayStatus(headwayMs) : null,
		};
	});
}

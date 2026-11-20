import { localParts } from "../calendar";

const MINUTE_MS = 60_000;

/**
 * 노선 목록에서 적재한 버스 노선의 정적 운행 정보(`bus_route`의 배차간격·첫차·막차).
 * 첫차·막차는 그 날 0시부터의 분이고, 막차가 자정을 넘으면 첫차보다 작은 값으로 온다.
 */
export interface BusSchedule {
	firstBusMinute: number | null;
	headwayMin: number;
	lastBusMinute: number | null;
}

/** 첫차와 막차 사이인가(양 끝 포함). 막차가 첫차보다 이르면 자정을 넘는 것으로 본다. */
function inService(minute: number, first: number, last: number): boolean {
	if (last >= first) {
		return minute >= first && minute <= last;
	}
	return minute >= first || minute <= last;
}

/**
 * 그 시각의 정적 배차간격(ms). 운행 시간 밖이거나 배차간격이 0 이하면 null.
 * 첫차나 막차 중 하나라도 모르면 시간 제한 없이 배차간격을 준다.
 * 시간대는 첫차·막차를 적은 출처의 현지 시간대다.
 */
export function scheduledHeadwayMs(
	schedule: BusSchedule,
	atEpochMs: number,
	timezone: string
): number | null {
	const { firstBusMinute, headwayMin, lastBusMinute } = schedule;
	if (headwayMin <= 0) {
		return null;
	}
	const hasServiceHours = firstBusMinute !== null && lastBusMinute !== null;
	if (
		hasServiceHours &&
		!inService(
			localParts(atEpochMs, timezone).minute,
			firstBusMinute,
			lastBusMinute
		)
	) {
		return null;
	}
	return headwayMin * MINUTE_MS;
}

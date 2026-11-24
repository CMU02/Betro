import type { RefResult } from "@/lib/ref/ref-client";

import type { StationView } from "./detail-client";

/** 받은 도착판과 받은 시각. 시각은 도착 추정의 기준이라 실패한 폴링이 덮어쓰지 않는다. */
export interface StationViewSnapshot {
	receivedAt: number;
	result: RefResult<StationView>;
}

/**
 * 새 응답을 반영한다. 폴링이 실패해도 마지막으로 받은 도착판은 그 시각 그대로 둔다.
 * 받은 적이 없으면 실패를 그대로 낸다.
 */
export function settleStationView(
	previous: StationViewSnapshot | undefined,
	next: RefResult<StationView>,
	now: number
): StationViewSnapshot {
	if (!next.ok && previous?.result.ok) {
		return previous;
	}
	return { receivedAt: now, result: next };
}

/** 화면이 보이는 동안만 다시 받는다. 가려지면 폴링을 멈춘다. */
export function stationPollInterval(
	visible: boolean,
	intervalMs: number
): number | false {
	return visible ? intervalMs : false;
}

export type StationViewPhase = "failed" | "loading" | "ready";

/** 도착판·첫차 막차 카드가 함께 따르는 상태. 받은 적이 없을 때만 loading/failed다. */
export function stationViewPhase(
	snapshot: StationViewSnapshot | undefined
): StationViewPhase {
	if (snapshot === undefined) {
		return "loading";
	}
	return snapshot.result.ok ? "ready" : "failed";
}

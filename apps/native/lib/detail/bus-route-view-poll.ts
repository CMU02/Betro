import type { RefResult } from "@/lib/ref/ref-client";
import type { BusRouteViewResponse } from "./detail-client";
import { isLiveStale } from "./live-stale";

type BusRouteViewResult = RefResult<BusRouteViewResponse>;

/** 받은 노선 보기와 받은 시각(기기 시각). 시각은 묵음 판단의 기준이라 실패한 폴링이 덮어쓰지 않는다. */
export interface BusRouteViewSnapshot {
	receivedAt: number;
	result: BusRouteViewResult;
}

/** 폴링이 실패해도 마지막으로 받은 노선 보기를 그 시각 그대로 둔다. 받은 적이 없으면 실패를 그대로 낸다. */
export function settleBusRouteView(
	previous: BusRouteViewSnapshot | undefined,
	next: BusRouteViewResult,
	now: number
): BusRouteViewSnapshot {
	if (!next.ok && previous?.result.ok) {
		return previous;
	}
	return { receivedAt: now, result: next };
}

/**
 * 지금 그릴 노선 보기. 받은 적이 없으면 null이다. 폴링이 실패해 마지막 응답이 묵음 기준보다
 * 오래됐으면 서버가 도착을 모를 때와 같은 꼴(estimated, 정류장 도착 없음)로 내린다. 배차간격은 둔다.
 */
export function busRouteViewAt(
	snapshot: BusRouteViewSnapshot | undefined,
	now: number
): BusRouteViewResponse | null {
	if (!snapshot?.result.ok) {
		return null;
	}
	const view = snapshot.result.value;
	return isLiveStale(snapshot.receivedAt, now)
		? { ...view, etaState: "estimated", stops: [] }
		: view;
}

/** 서버가 모르는 노선(400)일 때만 찾을 수 없음이다. 오프라인·503은 화면을 지우지 않는다. */
export function busRouteUnavailable(
	snapshot: BusRouteViewSnapshot | undefined
): boolean {
	return (
		snapshot !== undefined &&
		!snapshot.result.ok &&
		snapshot.result.reason === "invalid"
	);
}

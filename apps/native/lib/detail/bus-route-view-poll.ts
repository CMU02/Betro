import type { RefResult } from "@/lib/ref/ref-client";
import type { BusRouteViewResponse } from "./detail-client";

type BusRouteViewResult = RefResult<BusRouteViewResponse>;

/** 폴링이 실패해도 마지막으로 받은 노선 보기를 둔다. 받은 적이 없으면 실패를 그대로 낸다. */
export function settleBusRouteView(
	previous: BusRouteViewResult | undefined,
	next: BusRouteViewResult
): BusRouteViewResult {
	return !next.ok && previous?.ok ? previous : next;
}

/** 서버가 모르는 노선(400)일 때만 찾을 수 없음이다. 오프라인·503은 화면을 지우지 않는다. */
export function busRouteUnavailable(
	result: BusRouteViewResult | undefined
): boolean {
	return result !== undefined && !result.ok && result.reason === "invalid";
}

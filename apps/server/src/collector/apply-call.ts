import { normalizeBusPositions } from "@Betro/realtime/bus/normalize";
import {
	type AnyObservation,
	isSuccessfulOutcome,
} from "@Betro/realtime/metrics";
import type { BusReference, SubwayReference } from "@Betro/realtime/reference";
import { planKey } from "@Betro/realtime/schedule";
import { normalizeArrivals } from "@Betro/realtime/subway/normalize";
import { reduceArrivals } from "@Betro/realtime/subway/reduce-arrivals";
import type { CollectorState } from "./collector-state";
import type { ParsedCall } from "./upstream-call";

/** 운행 종료(headerCd 8)를 받은 버스 노선을 다시 확인하는 간격(수집 설계 7.2 "10분마다 확인"). */
export const SERVICE_ENDED_RECHECK_MS = 600_000;

/** 한 주기 동안 쓰는 참조(주기 안에서는 바뀌지 않는다). */
export interface References {
	bus: BusReference;
	busIds: string;
	subway: SubwayReference;
	subwayIds: string;
}

/** 마지막 시도의 결과를 정규화해 최신 상태와 이벤트에 반영하고 관측을 돌려준다. */
export function applyCall(
	state: CollectorState,
	refs: References,
	parsed: ParsedCall,
	at: number,
	warnOnce: (tag: string, line: string) => void
): AnyObservation[] {
	if (parsed.kind === "bus") {
		return applyBus(state, refs, parsed, at);
	}
	if (parsed.kind === "subway-position") {
		warnOnce(
			parsed.kind,
			"subway-position responses are recorded but not normalized"
		);
		return [];
	}
	if (parsed.outcome === "no-data") {
		state.latest.markSourceEmpty("subway", at);
		state.touch("subway", at);
		return [];
	}
	if (parsed.outcome !== "ok") {
		return [];
	}
	const { trains } = reduceArrivals(parsed.rows, refs.subway);
	const obs = normalizeArrivals(trains, refs.subway, at);
	state.addEvents("subway", at, state.latest.applySubway(obs, at));
	state.touch("subway", at);
	return obs;
}

function applyBus(
	state: CollectorState,
	refs: References,
	parsed: Extract<ParsedCall, { kind: "bus" }>,
	at: number
): AnyObservation[] {
	const { outcome, routeId, rows } = parsed;
	if (!isSuccessfulOutcome(outcome)) {
		return [];
	}
	const obs = normalizeBusPositions(
		routeId,
		rows,
		refs.bus,
		state.latest.busPrev(routeId),
		at
	);
	state.addEvents("bus", at, state.latest.applyBus(routeId, obs, at));
	state.touch("bus", at);
	const ended = outcome === "service-ended";
	if (ended) {
		// 다음 05:00까지 쉬면 일일 보고서가 그 구간을 멈춤으로 잡으므로 10분마다 확인한다.
		// 예산 간격이 10분보다 길면 그 간격을 지킨다.
		const key = planKey({ kind: "bus", routeId });
		state.schedule.nextAt[key] = Math.max(
			state.schedule.nextAt[key] ?? 0,
			at + SERVICE_ENDED_RECHECK_MS
		);
	}
	state.setResting(routeId, ended, at);
	return obs;
}

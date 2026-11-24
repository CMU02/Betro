import { normalizeBusPositions } from "@Betro/realtime/bus/normalize";
import { normalizeRegionalPositions } from "@Betro/realtime/bus/regional-normalize";
import {
	type AnyObservation,
	isSuccessfulOutcome,
} from "@Betro/realtime/metrics";
import type { BusReference, SubwayReference } from "@Betro/realtime/reference";
import { planKey } from "@Betro/realtime/schedule";
import { normalizeArrivals } from "@Betro/realtime/subway/normalize";
import { reduceArrivals } from "@Betro/realtime/subway/reduce-arrivals";
import type { UpstreamOutcome } from "@Betro/realtime/upstream/classify";
import type { CollectorState } from "./collector-state";
import type { ParsedCall } from "./upstream-call";

/** 운행 종료(headerCd 8)를 받은 버스 노선을 다시 확인하는 간격(수집 설계 7.2 "10분마다 확인"). */
export const SERVICE_ENDED_RECHECK_MS = 600_000;

/**
 * 실시간이 끊긴 것으로 남길 결과. 빈 응답(`no-data`)뿐 아니라 재시도까지 실패한 상류 장애
 * (네트워크, 5xx, 초당 한도, 요청 오류)도 넣는다. 그래야 장애가 3분 넘게 이어질 때 앱이 시간표
 * 추정 모드로 바뀐다(14). 한도 초과·인증 실패는 그날 멈춤(`stoppedToday`)으로 따로 알리므로 뺀다.
 * 다음 성공한 응답(`applySubway`·`applyBus`)이 지운다.
 */
function marksStale(outcome: UpstreamOutcome): boolean {
	return outcome !== "auth" && outcome !== "quota-exhausted";
}

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
	if (parsed.kind === "regional-bus") {
		return applyRegionalBus(state, refs, parsed, at);
	}
	if (parsed.kind === "subway-position") {
		warnOnce(
			parsed.kind,
			"subway-position responses are recorded but not normalized"
		);
		return [];
	}
	if (parsed.outcome !== "ok") {
		if (marksStale(parsed.outcome)) {
			state.latest.markSourceEmpty("subway", at);
			state.touch("subway", at);
		}
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
		if (marksStale(outcome)) {
			state.latest.markSourceEmpty({ busRouteId: routeId }, at);
			state.touch("bus", at);
		}
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

/**
 * GBIS·TAGO 위치. 실패한 호출은 직전 관측과 멈춤 판단 기록을 그대로 둔다(5-B 설계 결정 5).
 * 순번이 5분 넘게 그대로인 차량은 정규화가 빼고, 최신 상태에서도 TTL을 기다리지 않고 뺀다.
 */
function applyRegionalBus(
	state: CollectorState,
	refs: References,
	parsed: Extract<ParsedCall, { kind: "regional-bus" }>,
	at: number
): AnyObservation[] {
	const { outcome, routeKey, rows, source } = parsed;
	if (outcome === "no-data") {
		state.latest.applyBus(routeKey, [], at);
		state.touch("bus", at);
		return [];
	}
	const ref = refs.bus.routes.get(routeKey);
	if (outcome !== "ok" || !ref) {
		return [];
	}
	const { observations, prev } = normalizeRegionalPositions(
		routeKey,
		source,
		rows,
		ref,
		state.regionalPrev(routeKey),
		at
	);
	state.setRegionalPrev(routeKey, prev);
	const placed = new Set(observations.map((obs) => obs.vehId));
	state.latest.forgetBusVehicles(
		routeKey,
		rows.map((row) => row.vehId).filter((vehId) => !placed.has(vehId))
	);
	state.addEvents("bus", at, state.latest.applyBus(routeKey, observations, at));
	state.touch("bus", at);
	return observations;
}

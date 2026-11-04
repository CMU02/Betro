import type { BudgetKind } from "@Betro/realtime/budget";
import type { CallPlan } from "@Betro/realtime/schedule";
import {
	type BusPositionRow,
	parseBusPositions,
} from "@Betro/realtime/upstream/bus-position";
import {
	classifyBus,
	classifySubway,
	type UpstreamOutcome,
} from "@Betro/realtime/upstream/classify";
import {
	type ArrivalRow,
	parseStationArrivalAll,
} from "@Betro/realtime/upstream/subway-arrival";
import {
	busPositionUrl,
	subwayArrivalAllUrl,
	subwayPositionUrl,
} from "@Betro/realtime/upstream/urls";
import type { CollectorKeys, Upstream, UpstreamResponse } from "./ports";

/** 첫 시도 뒤 재시도 간격(지수 백오프). 길이가 최대 재시도 횟수다. */
export const RETRY_BACKOFF_MS: readonly number[] = [1000, 2000];

/** 같은 호출을 곧바로 다시 해 볼 만한 결과(7.5절: 네트워크, 일시 장애, 초당 한도). */
const RETRYABLE: ReadonlySet<UpstreamOutcome> = new Set([
	"network",
	"temporary",
	"rate-limited",
]);

export function isRetryable(outcome: UpstreamOutcome): boolean {
	return RETRYABLE.has(outcome);
}

export function budgetKindOf(plan: CallPlan): BudgetKind {
	return plan.kind === "bus" ? "bus" : "subway";
}

/** 원본 이력 스트림 이름(`raw/<stream>/...`). */
export function rawStreamOf(plan: CallPlan): string {
	switch (plan.kind) {
		case "subway-all":
			return "subway-all";
		case "subway-position":
			return `subway-position-${plan.lineNameKo}`;
		default:
			return `bus-${plan.routeId}`;
	}
}

export function urlOf(plan: CallPlan, keys: CollectorKeys): string {
	switch (plan.kind) {
		case "subway-all":
			return subwayArrivalAllUrl(keys.subway);
		case "subway-position":
			return subwayPositionUrl(keys.subway, plan.lineNameKo);
		default:
			return busPositionUrl(keys.bus, plan.routeId);
	}
}

/** `Upstream.fetch`가 약속을 어기고 던져도 응답 없음으로 바꾼다. */
export async function safeFetch(
	upstream: Upstream,
	url: string
): Promise<UpstreamResponse> {
	try {
		return await upstream.fetch(url);
	} catch (error) {
		return {
			body: "",
			error: error instanceof Error ? error.message : String(error),
			status: null,
		};
	}
}

export type ParsedCall =
	| { kind: "subway-all"; outcome: UpstreamOutcome; rows: ArrivalRow[] }
	/**
	 * `prod` 위치 API. 행 파서(`@Betro/transit-static/realtime/position-parser`)가 이 앱의
	 * 의존성에 없어 지금은 봉투로 분류만 하고 관측은 만들지 않는다.
	 */
	| { kind: "subway-position"; outcome: UpstreamOutcome }
	| {
			kind: "bus";
			outcome: UpstreamOutcome;
			routeId: string;
			rows: BusPositionRow[];
	  };

function parseJson(body: string): unknown {
	if (body === "") {
		return undefined;
	}
	try {
		return JSON.parse(body);
	} catch {
		return undefined;
	}
}

const XML_REASON = /<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/;

/** 공공데이터포털 게이트웨이 오류 본문(XML 또는 JSON)의 `returnReasonCode`. */
function gatewayReasonCode(body: string, json: unknown): string | undefined {
	const xml = XML_REASON.exec(body);
	if (xml) {
		return xml[1];
	}
	if (typeof json !== "object" || json === null) {
		return;
	}
	const header = (json as Record<string, unknown>).cmmMsgHeader;
	if (typeof header !== "object" || header === null) {
		return;
	}
	const code = (header as Record<string, unknown>).returnReasonCode;
	return typeof code === "string" || typeof code === "number"
		? String(code)
		: undefined;
}

/** realtimePosition 봉투만 본다(`errorMessage.code`). 행은 읽지 않는다. */
function positionEnvelope(
	json: unknown
):
	| { ok: true; rows: unknown[] }
	| { ok: false; code: string; message: string } {
	const envelope =
		typeof json === "object" && json !== null
			? (json as Record<string, unknown>)
			: {};
	const error = envelope.errorMessage ?? envelope;
	const code =
		typeof error === "object" && error !== null
			? (error as Record<string, unknown>).code
			: undefined;
	if (code === "INFO-000") {
		return { ok: true, rows: [] };
	}
	return {
		code: typeof code === "string" ? code : "MALFORMED",
		message: "",
		ok: false,
	};
}

/** 응답 → 7.5절 분류와 행. 행은 `ok`일 때만 채운다. */
export function parseCall(
	plan: CallPlan,
	response: UpstreamResponse
): ParsedCall {
	const { status, body } = response;
	const json = status === null ? undefined : parseJson(body);
	switch (plan.kind) {
		case "subway-all": {
			const parsed = json === undefined ? null : parseStationArrivalAll(json);
			const outcome = classifySubway(status, parsed);
			const rows = outcome === "ok" && parsed?.ok ? parsed.rows : [];
			return { kind: plan.kind, outcome, rows };
		}
		case "subway-position": {
			const parsed = json === undefined ? null : positionEnvelope(json);
			return { kind: plan.kind, outcome: classifySubway(status, parsed) };
		}
		default: {
			const parsed = json === undefined ? null : parseBusPositions(json);
			const outcome = classifyBus(
				status,
				parsed,
				gatewayReasonCode(body, json)
			);
			const rows = outcome === "ok" && parsed?.ok ? parsed.rows : [];
			return { kind: "bus", outcome, routeId: plan.routeId, rows };
		}
	}
}

import type { MessageKey } from "../i18n/translate";
import type { ServerClient } from "../server/api-client";
import {
	type ContentState,
	type EtaState,
	type PositionState,
	parseContentState,
} from "./content-state";

/** 서버 `SessionRouteView`(2-E Task 2)와 같은 모양. 시각은 epoch 초다. */
export interface SessionRouteView {
	/** 기본 경로는 지금 구간, 대안은 첫 구간의 탑승 예상. */
	boardEtaEpoch: number | null;
	destinationEtaEpoch: number | null;
	etaState: EtaState;
	positionState: PositionState;
	rank: number;
	stopsAway: number | null;
}

export interface ActiveSessionView {
	content: ContentState;
	planId: string;
	/** rank 오름차순 */
	routes: SessionRouteView[];
	sessionId: string;
}

export type ActiveSessionResult =
	| { ok: true; session: ActiveSessionView | null }
	| { ok: false; reason: "offline" | "invalid" };

export type EndResult = "ok" | "ended" | "failed";

const ACTIVE_PATH = "/v1/commute/sessions/active";
const OK = 200;
const NO_CONTENT = 204;
const NOT_FOUND = 404;
const CONFLICT = 409;

const ETA_STATES: readonly string[] = ["live", "estimated"];
const POSITION_STATES: readonly string[] = ["live", "stale", "none"];

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
	return value === null || isNumber(value);
}

function isEtaState(value: unknown): value is EtaState {
	return typeof value === "string" && ETA_STATES.includes(value);
}

function isPositionState(value: unknown): value is PositionState {
	return typeof value === "string" && POSITION_STATES.includes(value);
}

function parseRouteView(value: unknown): SessionRouteView | undefined {
	if (!isRecord(value)) {
		return;
	}
	const {
		boardEtaEpoch,
		destinationEtaEpoch,
		etaState,
		positionState,
		rank,
		stopsAway,
	} = value;
	if (
		!(
			isNumber(rank) &&
			isNullableNumber(boardEtaEpoch) &&
			isNullableNumber(destinationEtaEpoch) &&
			isNullableNumber(stopsAway) &&
			isEtaState(etaState) &&
			isPositionState(positionState)
		)
	) {
		return;
	}
	return {
		boardEtaEpoch,
		destinationEtaEpoch,
		etaState,
		positionState,
		rank,
		stopsAway,
	};
}

/** 키가 없으면 [](경로별 예상을 싣기 전의 서버). 배열이 아니거나 항목 하나라도 틀리면 undefined. */
function parseRouteViews(value: unknown): SessionRouteView[] | undefined {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		return;
	}
	const routes: SessionRouteView[] = [];
	for (const item of value) {
		const route = parseRouteView(item);
		if (route === undefined) {
			return;
		}
		routes.push(route);
	}
	return routes.sort((a, b) => a.rank - b.rank);
}

function parseSession(value: unknown): ActiveSessionView | null | undefined {
	if (value === null) {
		return null;
	}
	if (!isRecord(value)) {
		return;
	}
	const { planId, sessionId } = value;
	const content = parseContentState(value.content);
	const routes = parseRouteViews(value.routes);
	if (
		typeof planId !== "string" ||
		typeof sessionId !== "string" ||
		content === null ||
		routes === undefined
	) {
		return;
	}
	return { content, planId, routes, sessionId };
}

/**
 * 진행 중인 세션을 받는다. 던지지 않는다(실패를 값으로 돌려줘 쿼리 오류 보고가 15초마다 쌓이지 않게).
 * 네트워크 오류와 200이 아닌 응답(401, 503, 5xx)은 `offline`, 200인데 모양이 틀리면 `invalid`다.
 */
export async function fetchActiveSession(
	client: ServerClient
): Promise<ActiveSessionResult> {
	const response = await client.request("GET", ACTIVE_PATH);
	if (response.status !== OK) {
		return { ok: false, reason: "offline" };
	}
	if (!isRecord(response.json)) {
		return { ok: false, reason: "invalid" };
	}
	const session = parseSession(response.json.session);
	if (session === undefined) {
		return { ok: false, reason: "invalid" };
	}
	return { ok: true, session };
}

/** "안내 종료". 204는 `ok`, 없는 세션(404)과 이미 끝난 세션(409)은 `ended`, 그 밖은 `failed`. */
export async function endSession(
	client: ServerClient,
	sessionId: string
): Promise<EndResult> {
	const response = await client.request(
		"POST",
		`/v1/commute/sessions/${encodeURIComponent(sessionId)}/input`,
		{ kind: "end" }
	);
	if (response.status === NO_CONTENT) {
		return "ok";
	}
	if (response.status === NOT_FOUND || response.status === CONFLICT) {
		return "ended";
	}
	return "failed";
}

/** 화면이 그리는 세션 값. `checking`이면 마지막 값을 그대로 두고 "연결을 확인하고 있어요"를 보인다. */
export interface ActiveSessionState {
	checking: boolean;
	session: ActiveSessionView | null;
}

/** 받기에 실패하면 마지막으로 받은 세션을 그대로 둔다. */
export function settleActiveSession(
	previous: ActiveSessionState | undefined,
	result: ActiveSessionResult
): ActiveSessionState {
	if (result.ok) {
		return { checking: false, session: result.session };
	}
	return { checking: true, session: previous?.session ?? null };
}

/**
 * "안내 종료" 뒤에 할 일. 화면을 미리 바꾸지 않고 서버 값을 다시 받는다.
 * 이미 끝난 세션이면 세션 없음으로 바꾸고, 보내지 못했으면 다시 누르라고 한다.
 */
export function endOutcome(result: EndResult): {
	clear: boolean;
	notice: MessageKey | null;
} {
	if (result === "ended") {
		return { clear: true, notice: null };
	}
	if (result === "failed") {
		return { clear: false, notice: "commuteGuide.endFailed" };
	}
	return { clear: false, notice: null };
}

import {
	type AccuracyRecord,
	arrivalRecordOf,
	dailyReport,
	type FollowTarget,
	inputRecordOf,
	type LeaveMark,
	leaveRecordOf,
	recordsOf,
	type SessionSummary,
	suggestionRecordOf,
	summarize,
} from "@Betro/commute/accuracy";
import {
	dueStart,
	localParts,
	startMinutesToCheck,
} from "@Betro/commute/calendar";
import { type CommuteConfig, DEFAULT_TIMEZONE } from "@Betro/commute/config";
import type {
	BusLeg,
	CommutePlan,
	Leg,
	Route,
	SubwayLeg,
} from "@Betro/commute/plan";
import {
	type ApnsJwtCache,
	apnsEndRequest,
	apnsJwt,
	apnsStartRequest,
	apnsUpdateRequest,
	classifyApns,
	type PushOutcome,
	reusableJwt,
} from "@Betro/commute/push/apns";
import { classifyFcm, fcmCommuteRequest } from "@Betro/commute/push/fcm";
import { type LineRef, parseRef } from "@Betro/commute/refs";
import {
	activityAttributes,
	buildContent,
	type ContentState,
	decideSend,
	nextLeaveBoundaryMs,
	staleAtFor,
} from "@Betro/commute/session/content";
import {
	estimateRoute,
	type LegEstimate,
} from "@Betro/commute/session/estimate";
import { earlyBoardAfterSend } from "@Betro/commute/session/leave";
import {
	advance,
	type EndReason,
	type SessionInput,
	type SessionState,
	startSession,
} from "@Betro/commute/session/stage";
import {
	assembleBoards,
	legKey,
	type RawBoards,
} from "@Betro/commute/sources/assemble";
import {
	dropFrozen,
	dropFrozenPositions,
	updateSeen,
	type VehicleSeen,
} from "@Betro/commute/sources/frozen";
import {
	matchTagoVehicles,
	type RegionalPosition,
	type RegionalSource,
	type RegionalStop,
} from "@Betro/commute/sources/regional-bus";
import type { RouteStopArrival } from "@Betro/commute/sources/seoul-bus";
import type { StationRow } from "@Betro/commute/sources/seoul-subway";
import type {
	ArrivalMethod,
	StopBoard,
	TransitBoards,
} from "@Betro/commute/sources/types";
import { FCM_PROJECT_ID } from "@Betro/realtime/alerts";
import { redactKeys } from "@Betro/realtime/upstream/urls";
import { RETRY_BACKOFF_MS } from "../collector/upstream-call";
import { errorText, runLimited, secretVariants } from "../collector/util";
import type { PushTokenRow } from "./auth";
import {
	type RegionalRouteRef,
	type RunnerPorts,
	UpstreamStoppedError,
} from "./ports";

const SESSION_PREFIX = "session:";
/** 끝난 세션(설치 ID, 종료 시각). 끝난 세션의 입력에 "ended"를 돌려주려고 하루 남긴다. */
const ENDED_PREFIX = "ended:";
const BUS_PREFIX = "busRoute:";
/** 역별 직전·지금 행. 수집기는 최근 행만 주므로 `passed`를 찾으려고 직전 것을 둔다. */
const STATION_PREFIX = "station:";
/**
 * 하루 예산. 서울 버스 도착은 `budget:<day>`, 지역 버스는 `budget:<source>-<op>:<day>`
 * (`op` = `arrival` | `location`)다.
 */
const BUDGET_PREFIX = "budget:";
/** 그날 멈춘 출처. 서울 버스는 `stopped:<day>`, 지역 버스는 `stopped:<source>:<day>`다. */
const STOPPED_PREFIX = "stopped:";
/** 지역(GBIS·TAGO) 노선의 직전·지금 도착과 위치(`regionalBus:<전체 노선 ID>`). */
const REGIONAL_PREFIX = "regionalBus:";
/** 지역 노선 차량별 순번이 마지막으로 바뀐 시각(`regionalSeen:<전체 노선 ID>`). 멈춘 차량을 거른다. */
const SEEN_PREFIX = "regionalSeen:";
/** 지도 용도 지역 호출이 남기는 세션 몫: 각 출처·오퍼레이션 예산의 3분의 1(5-B 설계 결정 1). */
const REGIONAL_SESSION_SHARE = 1 / 3;
/** 지역 호출은 응답이 없으면 서울과 같은 첫 백오프 뒤 한 번만 다시 부른다(5-B 설계 결정 5). */
const REGIONAL_RETRIES = 1;
const APNS_JWT_KEY = "apnsJwt";
const FCM_ACCESS_KEY = "fcmAccess";
/** 제안 판정을 위해 하차 정류장까지 따라가는 차량(`follow:<세션ID>`). */
const FOLLOW_PREFIX = "follow:";
/** 마지막으로 쓴 일일 보고서의 날짜. */
const REPORT_DATE_KEY = "commuteReportDate";
const RECORDS_PREFIX = "commute/records/";
const SUMMARIES_PREFIX = "commute/summaries/";
const REPORTS_PREFIX = "commute/reports/";
const GZIP_TYPE = "application/gzip";
const JSON_TYPE = "application/json";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** 세션이 보는 역을 수집기에 등록해 두는 시간. tick마다 늘린다. */
const WATCH_MS = 5 * MINUTE_MS;
const TIMETABLE_REFRESH_MS = 10 * MINUTE_MS;
const TIMETABLE_ARRIVALS = 6;
const ENDED_KEEP_MS = DAY_MS;
/** 제안이 나간 세션은 끝난 뒤에도 이만큼 두 차량의 하차를 기다린다. */
const FOLLOW_AFTER_END_MS = 30 * MINUTE_MS;
/**
 * 서비스일 D의 보고서는 D+1 04:00부터 쓴다. D의 세션은 늦어도 D+1 03:00 전에 끝나고
 * (시작 23:5x + 최대 3시간), 제안을 따라가는 30분도 그 안에 끝난다.
 */
const REPORT_DELAY_MS = DAY_MS + 4 * 60 * MINUTE_MS;
const HOLIDAY_COUNTRY = "KR";
const TOKEN_SHOWN_LENGTH = 8;
const FCM_UNREGISTERED_STATUS = 404;
/**
 * 한 세션에서 갱신이 `config`(토큰이 아닌 400·403)로 거절돼도 되는 횟수. 이만큼 거절되면 종료를 한 번
 * 보내고 `push-rejected`로 닫는다. 설정이 틀린 채로 tick마다 3시간 보내지 않게 하는 안전 상한이다.
 */
const PUSH_REJECT_LIMIT = 3;
/** 키를 지운 로그에도 남을 수 있는 키 모양: 쿼리 `serviceKey=…`, 서울 지하철 경로의 키. */
const KEY_QUERY = /((?:service)?key=)[^&\s"']+/gi;
const SUBWAY_KEY_PATH = /(\/api\/subway\/)[^/\s"']+/g;
const PEM_LINE_BREAK = /\r?\n|\\n/;
const encoder = new TextEncoder();
const MIN_SECRET_LINE = 16;
/** 지도 용도 호출이 세션 몫에 닿아 부르지 않았다. 캐시만 쓰고 폴링 시각도 찍지 않는다. */
const RESERVED = "reserved";

type Platform = "ios" | "android";
/**
 * 푸시 한 번의 결과. `unconfirmed`는 응답을 받지 못한 것이다(예외, 10초 타임아웃). 상대가 이미
 * 받았을 수 있다.
 */
type SendOutcome = PushOutcome | "unconfirmed";
interface PlanRecord {
	installId: string;
	plan: CommutePlan;
}
/** 경로 조회 결과. undefined는 조회 실패(이번 tick은 그 세션을 건너뛴다). */
type PlanLookup = Map<string, PlanRecord | null | undefined>;

/** 저장소 키 `session:<id>`. JSON으로 그대로 저장한다. */
export interface SessionEntry {
	/** 예약 시작 시각(`startAt`). */
	dueAt: number;
	installId: string;
	/** 마지막으로 보낸 값. null이면 아직 시작을 보내지 못했다. */
	lastContent: ContentState | null;
	/**
	 * 마지막으로 남긴 `leave` 기록의 문장·safeLeaveAt·차량. 같은 값이면 다시 남기지 않는다.
	 * 이 필드가 생기기 전에 저장된 세션 항목에는 없다(null로 본다).
	 */
	lastLeave?: LeaveMark | null;
	lastSentAt: number | null;
	platform: Platform | null;
	/**
	 * 갱신이 `config`로 거절된 횟수. `PUSH_REJECT_LIMIT`에 닿으면 닫는다. 이 필드가 생기기 전에
	 * 저장된 세션 항목에는 없다(0으로 본다).
	 */
	rejectedUpdates?: number;
	serviceDate: string;
	/** 기기가 처음 그린 시각(ack). */
	shownAt: number | null;
	/** 시작 푸시가 나간 시각. 자동 시작 기록(`start`)에 쓴다. */
	startSentAt: number | null;
	state: SessionState;
	timetable: RawBoards["timetable"];
	timetableAt: number | null;
	/** 이 세션의 업데이트 토큰이 서버에 도착한 시각. */
	tokenAt: number | null;
	/** 시작을 보낸 뒤 업데이트 토큰을 기다리는 끝 시각(iOS). */
	tokenWaitUntil: number | null;
	/** false면 업데이트 토큰이 오지 않아 갱신을 보내지 못하는 세션이다. */
	updatable: boolean;
}

interface BusRouteSaved {
	data: {
		fetchedAt: number;
		now: RouteStopArrival[];
		prev: RouteStopArrival[] | null;
	} | null;
	/** 마지막으로 부르려고 한 tick 시각. 간격은 이것으로 잰다. */
	polledAt: number;
}

type RegionalData = NonNullable<RawBoards["regionalBus"]>[LineRef];

interface RegionalSaved {
	data: RegionalData | null;
	/** 마지막으로 부르려고 한 tick 시각. 간격은 이것으로 잰다. */
	polledAt: number;
}

type RegionalOp = "arrival" | "location";

/** 지역 호출 한 번(재시도 포함)의 조건. */
interface RegionalCall<T> {
	day: string;
	fetch: () => Promise<T | null>;
	now: number;
	op: RegionalOp;
	purpose: BusArrivalPurpose;
	source: RegionalSource;
}

/** 한 tick에 부를 지역 노선 하나. 같은 노선·정류장은 세션이 여럿이어도 한 번만 부른다. */
interface RegionalTarget {
	line: LineRef;
	/** 탄 구간이나 따라가는 구간이 있어 위치 목록이 필요한가. */
	locations: boolean;
	/** 그 노선의 탈 차량이 가까운 탑승 전 세션이 있는가. */
	near: boolean;
	routeId: string;
	source: RegionalSource;
	/** 부를 정류장(순번 → 정류장). */
	stops: Map<number, RegionalStop>;
}

interface StationEntry {
	fetchedAt: number;
	rows: StationRow[];
}

interface StationSaved {
	cur: StationEntry;
	prev: StationEntry | null;
}

/**
 * `follow:<세션ID>`. 제안이 나가면 두 차량을 하차 정류장까지 따라간다. 세션이 열려 있는 동안
 * `until`은 null이고, 닫히면 `FOLLOW_AFTER_END_MS` 뒤로 정한다. 두 차량이 모두 닿거나 `until`이
 * 지나면 기록을 요약해 R2에 쓰고 지운다. 쓰기에 실패하면 남겨 두고 다음 tick에 다시 쓴다.
 */
interface FollowEntry {
	items: (FollowTarget & { done: boolean })[];
	serviceDate: string;
	until: number | null;
}

interface EndedMark {
	endedAt: number;
	installId: string;
}

/** 진행 중 세션 응답에 실리는, 등록한 경로 하나의 예상. 시각은 ContentState처럼 초 단위. */
export interface SessionRouteView {
	/** 기본 경로는 지금 구간, 대안은 첫 구간의 탑승 예상(초). */
	boardEtaEpoch: number | null;
	destinationEtaEpoch: number | null;
	etaState: "live" | "estimated";
	/** 경로의 구간별 차량 ID. 기본 경로에서 차량을 잡았거나 탄 구간은 `fixed` 값이다. */
	legVehicleIds: (string | null)[];
	positionState: "live" | "stale" | "none";
	rank: number;
	stopsAway: number | null;
}

export interface ActiveSession {
	content: ContentState;
	planId: string;
	/** rank 오름차순, 등록한 경로 수만큼. */
	routes: SessionRouteView[];
	sessionId: string;
}

const toEpochSeconds = (at: number | null | undefined): number | null =>
	at === null || at === undefined ? null : Math.floor(at / 1000);

function sessionRouteView(
	rank: number,
	state: SessionEntry["state"]
): SessionRouteView {
	const estimate = state.estimates.find((entry) => entry.rank === rank);
	const leg = estimate?.legs[rank === 0 ? state.legIndex : 0];
	return {
		boardEtaEpoch: toEpochSeconds(leg?.boardEtaAt),
		destinationEtaEpoch: toEpochSeconds(estimate?.destinationEtaAt),
		etaState: leg?.etaState ?? "estimated",
		legVehicleIds: (estimate?.legs ?? []).map(
			(entry, index) =>
				(rank === 0 ? state.fixed[index] : null) ?? entry.vehicleId ?? null
		),
		positionState: leg?.positionState ?? "none",
		rank,
		stopsAway: leg?.stopsAway ?? null,
	};
}

export type InputResult = "ok" | "not-found" | "ended";

/**
 * 버스 도착정보 호출의 용도. `map`은 하루 예산이 `dailyBudgetBusArrival − busArrivalSessionReserve`에
 * 닿으면 부르지 않고 캐시만 쓴다. 출퇴근 세션 몫을 지도가 먹지 않게 한다(지도 설계 4.3).
 */
export type BusArrivalPurpose = "session" | "map";

/** 경로 보기의 구간 하나. 시각은 epoch ms. */
export interface RouteViewLeg {
	/** 승차 정류장(역) 도착판의 다가오는 차량, 가까운 순서. */
	approaching: {
		etaAt: number | null;
		method: ArrivalMethod | null;
		stopsAway: number | null;
		vehicleId: string;
	}[];
	boardEtaAt: number | null;
	etaState: "live" | "estimated";
	method: ArrivalMethod | null;
	positionState: "live" | "stale" | "none";
	vehicleId: string | null;
}

/** 지도에서 고른 경로 하나의 예상. 잠금화면과 같은 `estimateRoute`로 낸다(지도 설계 4.6). */
export interface RouteView {
	destinationEtaAt: number | null;
	legs: RouteViewLeg[];
}

function routeViewLeg(
	estimate: LegEstimate | undefined,
	board: StopBoard | null
): RouteViewLeg {
	return {
		approaching: (board?.approaching ?? []).map(
			({ etaAt, method, stopsAway, vehicleId }) => ({
				etaAt,
				method,
				stopsAway,
				vehicleId,
			})
		),
		boardEtaAt: estimate?.boardEtaAt ?? null,
		etaState: estimate?.etaState ?? "estimated",
		method: estimate?.method ?? null,
		positionState: estimate?.positionState ?? "none",
		vehicleId: estimate?.vehicleId ?? null,
	};
}

const sessionKey = (id: string): string => `${SESSION_PREFIX}${id}`;
const nextMinute = (now: number): number =>
	Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
const dayOf = (now: number): string => localParts(now, DEFAULT_TIMEZONE).date;
const followKey = (id: string): string => `${FOLLOW_PREFIX}${id}`;

/** cron이 `writeDailyReport`에 넘길 날짜: D+1 04:00(현지)부터 서비스일 D. */
export function commuteReportDate(now: number, timezone: string): string {
	return localParts(now - REPORT_DELAY_MS, timezone).date;
}

async function gzip(text: string): Promise<Uint8Array> {
	const stream = new Blob([encoder.encode(text)])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function isSummary(value: unknown): value is SessionSummary {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.sessionId === "string" &&
		Array.isArray(record.predictions) &&
		Array.isArray(record.suggestions)
	);
}

function parseSummary(text: string | null): SessionSummary | null {
	if (text === null) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return isSummary(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** 아직 하차를 보지 못한 따라가는 구간. */
function followLegs(follows: Map<string, FollowEntry>): Leg[] {
	return [...follows.values()].flatMap((follow) =>
		follow.items.filter((item) => !item.done).map((item) => item.leg)
	);
}

function sameTarget(a: FollowTarget, b: FollowTarget): boolean {
	return a.vehicleId === b.vehicleId && legKey(a.leg) === legKey(b.leg);
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

function isBeforeBoarding(state: SessionState): boolean {
	return state.stage === "walk" || state.stage === "wait";
}

function endedState(state: SessionState, reason: EndReason): SessionState {
	if (state.stage === "ended") {
		return state;
	}
	return { ...state, endReason: reason, passed: null, stage: "ended" };
}

type PushReply = { reason: string | null; status: number } | null;

/** 응답이 없으면(`#push`가 예외를 삼켰으면) `unconfirmed`. */
function outcomeOf(
	result: PushReply,
	classify: (status: number, reason: string | null) => PushOutcome
): SendOutcome {
	return result ? classify(result.status, result.reason) : "unconfirmed";
}

/** 새로 만든 JWT·액세스 토큰도 인증 오류면 키나 계정 설정 문제라 `config`로 본다. */
function renewedOutcome(outcome: SendOutcome): SendOutcome {
	return outcome === "jwt-expired" ? "config" : outcome;
}

/** 둘 중 이른 시각. null은 없는 것으로 본다. */
function earlierOf(a: number, b: number | null): number;
function earlierOf(a: number | null, b: number | null): number | null;
function earlierOf(a: number | null, b: number | null): number | null {
	if (a === null) {
		return b;
	}
	return b === null ? a : Math.min(a, b);
}

/** 마지막으로 보낸 값이 now 뒤에 시계만으로 다른 문장이 되는 시각. 보낸 값이 없으면 null. */
function leaveBoundaryOf(entry: SessionEntry, now: number): number | null {
	return entry.lastContent === null
		? null
		: nextLeaveBoundaryMs(entry.lastContent, now);
}

/** 시작 푸시 결과로 세션을 닫아야 하면 그 이유. 다시 보내거나 이어 가면 null. */
function startCloseReason(outcome: SendOutcome): EndReason | null {
	if (outcome === "token-dead") {
		return "no-token";
	}
	return outcome === "config" ? "push-rejected" : null;
}

/** 가장 최근에 올라온 토큰. */
function latestToken(
	rows: readonly PushTokenRow[],
	match: (row: PushTokenRow) => boolean
): PushTokenRow | null {
	let found: PushTokenRow | null = null;
	for (const row of rows) {
		if (match(row) && (found === null || row.updatedAt > found.updatedAt)) {
			found = row;
		}
	}
	return found;
}

function platformOf(rows: readonly PushTokenRow[]): Platform | null {
	if (rows.some((row) => row.kind === "apns-start")) {
		return "ios";
	}
	return rows.some((row) => row.kind === "fcm") ? "android" : null;
}

/** 지금 도착판이 필요한 구간: 기본 경로의 지금 구간부터, 탑승 전이면 대안 전부. */
function watchedLegs(state: SessionState, plan: CommutePlan): Leg[] {
	if (state.stage === "arrived" || state.stage === "ended") {
		return [];
	}
	const legs: Leg[] = [];
	for (const route of plan.routes) {
		if (route.rank === 0) {
			legs.push(...route.legs.slice(state.legIndex));
		} else if (isBeforeBoarding(state)) {
			legs.push(...route.legs);
		}
	}
	return legs;
}

/**
 * 실시간 도착 정보를 부르는 서울 버스 구간이면 맨 노선 ID(`busRouteId`), 아니면 null.
 * GBIS·TAGO 구간은 `regionalSourceOf`로 따로 부른다. GBIS 노선 ID는 서울 것과 같은 값일 수
 * 있으니 ID만 보고 서울 도착 정보를 부르면 안 된다.
 */
function seoulBusRouteIdOf(leg: Leg): string | null {
	if (leg.mode !== "bus") {
		return null;
	}
	const { id, source } = parseRef(leg.line);
	return source === "seoul-bus" ? id : null;
}

/** GBIS·TAGO 버스 구간이면 그 출처, 아니면 null. */
function regionalSourceOf(leg: Leg): RegionalSource | null {
	if (leg.mode !== "bus") {
		return null;
	}
	const { source } = parseRef(leg.line);
	return source === "gbis" || source === "tago" ? source : null;
}

/**
 * 지역 구간의 정류장 하나를 대상에 더한다. 승차 전 구간은 승차 정류장, 탄 구간과 따라가는 구간은
 * 하차 정류장과 위치 목록이다(탄 차량은 하차 정류장 도착에 나오지 않을 수 있다, 5-B 확인 2).
 */
function addRegionalTarget(
	targets: Map<LineRef, RegionalTarget>,
	leg: BusLeg,
	source: RegionalSource,
	at: "board" | "alight",
	near: boolean
): void {
	const target = targets.get(leg.line) ?? {
		line: leg.line,
		locations: false,
		near: false,
		routeId: parseRef(leg.line).id,
		source,
		stops: new Map<number, RegionalStop>(),
	};
	const { seq, stop } = leg[at];
	target.stops.set(seq, { seq, stopId: parseRef(stop).id });
	target.near = target.near || near;
	target.locations = target.locations || at === "alight";
	targets.set(leg.line, target);
}

/**
 * 탑승 전 기본 경로의 지금 구간이 지역 버스이고, 잡아 둔 차량이 새 승차 정류장 도착판에 없고 지나지도
 * 않았으면 그 차량을 놓는다(건너뛴 차량으로 보지 않는다). 다음 걸음이 다음 차량이나 배차간격 추정을
 * 고른다. 멈춘 차량을 뺐거나(5-B 설계 결정 6), TAGO 차량 ID가 위치 목록 없이 `tago-pos:`로
 * 바뀐 경우다(결정 7). 서울 구간은 그대로 둔다.
 */
function releaseVanishedRegional(
	state: SessionState,
	plan: CommutePlan,
	boards: TransitBoards
): SessionState {
	const index = state.legIndex;
	const fixedId = state.fixed[index] ?? null;
	const leg = plan.routes.find((route) => route.rank === 0)?.legs[index];
	const isPinnedRegional =
		isBeforeBoarding(state) &&
		fixedId !== null &&
		leg !== undefined &&
		regionalSourceOf(leg) !== null;
	if (!isPinnedRegional) {
		return state;
	}
	const board = boards.board(leg, "board");
	const isListed =
		board === null ||
		board.approaching.some((vehicle) => vehicle.vehicleId === fixedId) ||
		board.passed.some((entry) => entry.vehicleId === fixedId);
	if (isListed) {
		return state;
	}
	return {
		...state,
		fixed: state.fixed.map((id, at) => (at === index ? null : id)),
	};
}

/** 기본 경로에서 지금 타고 있는 구간. 탑승 전이거나 끝났으면 null. */
function ridingLeg(state: SessionState, plan: CommutePlan): Leg | null {
	if (state.stage !== "ride") {
		return null;
	}
	const primary = plan.routes.find((route) => route.rank === 0);
	return primary?.legs[state.legIndex] ?? null;
}

/**
 * 위치 목록을 못 읽은 poll이 이어 쓸 직전 위치와 그 위치를 받은 시각. 받은 지 묵음 기준보다 오래됐으면
 * null이다. `positionsAt`이 없는 원자료(이전 형식)는 `fetchedAt`으로 본다.
 */
function carriedPositions(
	prev: RegionalData | null,
	now: number,
	staleAfterMs: number
): { at: number; positions: Record<string, number> } | null {
	if (prev === null) {
		return null;
	}
	const at = prev.positionsAt ?? prev.fetchedAt;
	return now - at <= staleAfterMs ? { at, positions: prev.positions } : null;
}

/** 저장한 위치(차량 ID → 순번) → TAGO 차량 맞추기 입력. TAGO 위치의 차량 ID는 차량 번호다. */
function tagoPositionsOf(
	bySeq: Readonly<Record<string, number>>
): RegionalPosition[] {
	return Object.entries(bySeq).map(([vehicleId, seq]) => ({
		plate: vehicleId,
		seq,
		vehicleId,
	}));
}

/** 직전 도착에 있던 차량이 같은 정류장의 지금 도착에서 빠졌는가(그 정류장을 지났을 수 있다). */
function vehicleLeft(
	prev: RegionalData | null,
	fetched: readonly RouteStopArrival[]
): boolean {
	const before = new Map((prev?.now ?? []).map((stop) => [stop.seq, stop]));
	return fetched.some((stop) => {
		const listed = new Set(stop.vehicles.map((vehicle) => vehicle.vehicleId));
		return (
			before
				.get(stop.seq)
				?.vehicles.some((vehicle) => !listed.has(vehicle.vehicleId)) ?? false
		);
	});
}

/**
 * GBIS 직전 도착의 차량이 지금 도착에서 빠졌는데 그 정류장을 지났는지 모르는 정류장 순번. 위치 목록을
 * 읽지 못했고 직전 위치로도 지난 것을 모르거나, 위치 목록에서 아직 그 정류장 앞에 있으면 그렇다. 이런
 * 정류장은 이번에 부르지 않은 것으로 보고 직전 도착을 둔다. 그래야 잡아 둔 차량을 놓지 않고 다음 poll이
 * 다시 지났는지 본다. 위치 목록을 읽었는데 없는 차량(운행을 마쳤다)은 기다리지 않는다. 둔 정류장의 차량은
 * 순번이 그대로라 5분 넘게 이어지면 멈춘 차량으로 빠진다.
 */
function unsettledStops(
	prev: RegionalData | null,
	fetched: readonly RouteStopArrival[],
	positions: Readonly<Record<string, number>>,
	isFresh: boolean
): Set<number> {
	const before = new Map((prev?.now ?? []).map((stop) => [stop.seq, stop]));
	const unsettled = new Set<number>();
	for (const stop of fetched) {
		const listed = new Set(stop.vehicles.map((vehicle) => vehicle.vehicleId));
		const isUnknown =
			before.get(stop.seq)?.vehicles.some((vehicle) => {
				if (listed.has(vehicle.vehicleId)) {
					return false;
				}
				const seq = positions[vehicle.vehicleId];
				return seq === undefined ? !isFresh : seq < stop.seq;
			}) ?? false;
		if (isUnknown) {
			unsettled.add(stop.seq);
		}
	}
	return unsettled;
}

/**
 * 버스 구간 하나를 대상에 더한다. 서울 노선은 노선 전체를 부르고(가까운 차량 여부만 OR), 지역 노선은
 * `at` 정류장을 부른다. 정적 일정은 출처와 상관없이 읽는다.
 */
function addBusTarget(
	targets: BoardTargets,
	leg: BusLeg,
	at: "board" | "alight",
	near: boolean
): void {
	targets.busLines.add(leg.line);
	const routeId = seoulBusRouteIdOf(leg);
	const source = regionalSourceOf(leg);
	if (routeId !== null) {
		const { busRoutes } = targets;
		busRoutes.set(routeId, (busRoutes.get(routeId) ?? false) || near);
	} else if (source !== null) {
		addRegionalTarget(targets.regional, leg, source, at, near);
	}
}

function regionalBudgetOf(
	config: CommuteConfig,
	source: RegionalSource,
	op: RegionalOp
): number {
	if (source === "gbis") {
		return op === "arrival"
			? config.dailyBudgetGbisArrival
			: config.dailyBudgetGbisLocation;
	}
	return op === "arrival"
		? config.dailyBudgetTagoArrival
		: config.dailyBudgetTagoLocation;
}

/** 한 tick에 모을 도착판의 대상. */
interface BoardTargets {
	/** 정적 일정을 읽을 버스 노선(전체 노선 ID). 실시간 연결이 없는 노선도 들어간다. */
	busLines: Set<LineRef>;
	/** 서울 busRouteId → 탈 차량이 가까운 탑승 전 세션이 있는가. */
	busRoutes: Map<string, boolean>;
	/** 지역(GBIS·TAGO) 노선(전체 노선 ID) → 부를 정류장과 위치 목록. */
	regional: Map<LineRef, RegionalTarget>;
	stations: Set<string>;
}

function subwayLegsIn(legs: Leg[]): SubwayLeg[] {
	return legs.filter((leg): leg is SubwayLeg => leg.mode === "subway");
}

function subwayLegsOf(plan: CommutePlan): SubwayLeg[] {
	return subwayLegsIn(plan.routes.flatMap((route) => route.legs));
}

/** 경로를 지웠을 때 보낼 종료 값. 경로가 없으니 마지막으로 보낸 값을 바탕으로 한다. */
function endedContentFrom(
	last: ContentState,
	state: SessionState,
	now: number
): ContentState {
	return {
		...last,
		nextLegs: [],
		passed: null,
		sentAt: Math.floor(now / 1000),
		seq: state.seq + 1,
		stage: "ended",
		suggestion: null,
	};
}

function privateKeyOf(serviceAccountJson: string): string {
	try {
		const parsed: unknown = JSON.parse(serviceAccountJson);
		if (typeof parsed === "object" && parsed !== null) {
			const key = (parsed as Record<string, unknown>).private_key;
			return typeof key === "string" ? key : "";
		}
	} catch {
		// 모양이 다르면 통째로만 가린다.
	}
	return "";
}

/** 가릴 문자열: p8과 서비스 계정 JSON 통째, 그리고 PEM 본문 줄 하나하나. */
function secretTexts(ports: RunnerPorts): string[] {
	const { apnsP8, fcmServiceAccountJson } = ports.secrets;
	const texts = [apnsP8, fcmServiceAccountJson];
	for (const pem of [apnsP8, privateKeyOf(fcmServiceAccountJson)]) {
		for (const line of pem.split(PEM_LINE_BREAK)) {
			const trimmed = line.trim();
			if (trimmed.length >= MIN_SECRET_LINE && !trimmed.startsWith("-----")) {
				texts.push(trimmed);
			}
		}
	}
	return texts.filter((text) => text !== "");
}

/**
 * 출퇴근 세션 실행기 본체. Durable Object가 포트를 넣어 한 번 만들고 alarm마다 `tick`을 부른다.
 * 재시작 뒤에도 이어져야 하는 값(세션, JWT, 액세스 토큰, 예산, 도착판)은 모두 `store`에 두고,
 * 바꾼 값은 tick이 끝나기 전에 쓴다.
 */
export class RunnerCore {
	readonly #ports: RunnerPorts;
	readonly #secrets: readonly string[];
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #tokensSeen = new Set<string>();
	/** 세션별로 이번 걸음에 모은 정확도 기록. 걸음이 끝나기 전에 `records`에 쓴다. */
	readonly #pending = new Map<string, AccuracyRecord[]>();
	readonly #warned = new Set<string>();
	/** 찾은 TAGO 노선 도시 코드(전체 노선 ID → 도시 코드). 없는 노선은 두지 않고 다시 묻는다. */
	readonly #cities = new Map<LineRef, string>();
	#queue: Promise<unknown> = Promise.resolve();

	constructor(ports: RunnerPorts) {
		this.#ports = ports;
		this.#secrets = secretVariants(secretTexts(ports));
		this.#sleep = ports.sleep ?? defaultSleep;
	}

	/**
	 * 한 주기: 예약 확인 → 도착판 모으기 → 세션마다 단계 진행·전송 → 정리.
	 * 세션이 있으면 `tickMs` 뒤, 없으면 다음 분 경계에 다시 부른다.
	 */
	tick(): Promise<{ nextAlarmAt: number }> {
		return this.#exclusive(() => this.#tick());
	}

	/** 잠금화면 버튼 입력. 바로 단계를 진행하고 바뀐 값을 보낸다. */
	input(
		installId: string,
		sessionId: string,
		input: SessionInput
	): Promise<InputResult> {
		return this.#exclusive(() => this.#input(installId, sessionId, input));
	}

	/** 기기가 처음 그린 시각(자동 시작 ±1분 판정용). 처음 값만 남긴다. */
	ack(
		installId: string,
		sessionId: string,
		at: number
	): Promise<"ok" | "not-found"> {
		return this.#exclusive(async () => {
			const { store } = this.#ports;
			const entry = await store.get<SessionEntry>(sessionKey(sessionId));
			if (!entry || entry.installId !== installId) {
				return "not-found";
			}
			if (entry.shownAt === null) {
				entry.shownAt = at;
				await store.put(sessionKey(sessionId), entry);
			}
			return "ok";
		});
	}

	/** 그 설치의 진행 중인 세션(가장 최근 예약). */
	async activeSession(installId: string): Promise<ActiveSession | null> {
		const { clock, config, plans, store } = this.#ports;
		const entries = await store.list<SessionEntry>(SESSION_PREFIX);
		let best: { entry: SessionEntry; id: string } | null = null;
		for (const [key, entry] of entries) {
			const mine =
				entry.installId === installId && entry.state.stage !== "ended";
			if (mine && (best === null || entry.dueAt > best.entry.dueAt)) {
				best = { entry, id: key.slice(SESSION_PREFIX.length) };
			}
		}
		if (best === null) {
			return null;
		}
		const { entry, id } = best;
		const record = await plans.getPlan(entry.state.planId);
		const owned = record && record.installId === installId ? record : null;
		let content = entry.lastContent;
		if (content === null) {
			if (owned === null) {
				return null;
			}
			content = buildContent(entry.state, owned.plan, clock(), config);
		}
		const ranks =
			owned === null
				? entry.state.estimates.map((estimate) => estimate.rank)
				: owned.plan.routes.map((route) => route.rank);
		const routes = ranks
			.toSorted((a, b) => a - b)
			.map((rank) => sessionRouteView(rank, entry.state));
		return { content, planId: entry.state.planId, routes, sessionId: id };
	}

	/**
	 * 지도에서 고른 경로 하나의 예상. 버스는 세션과 같은 노선별 도착정보 캐시를 지도 용도로 쓰고,
	 * 지하철은 수집기의 역 도착판과 시간표를 쓴다. `readyAt`은 첫 도보 뒤다. 저장소의 예산·캐시를
	 * 고치므로 tick과 겹치지 않게 차례로 돈다. 조회가 실패한 구간은 시각 없는 추정으로 둔다.
	 */
	routeView(route: Route, now: number): Promise<RouteView> {
		return this.#exclusive(() => this.#routeView(route, now));
	}

	/**
	 * `commute/summaries/<date>/`를 모아 `commute/reports/<date>.json`을 쓴다. 마지막으로 쓴 날짜를
	 * 저장해 같은 날(또는 그 전 날)은 다시 쓰지 않는다. 썼으면 true.
	 */
	writeDailyReport(date: string): Promise<boolean> {
		return this.#exclusive(async () => {
			const { blobs, store } = this.#ports;
			const last = await store.get<string>(REPORT_DATE_KEY);
			if (last !== undefined && date <= last) {
				return false;
			}
			const keys = await blobs.list(`${SUMMARIES_PREFIX}${date}/`);
			const texts = await Promise.all(keys.map((found) => blobs.get(found)));
			const summaries = texts
				.map(parseSummary)
				.filter((summary): summary is SessionSummary => summary !== null);
			const report = dailyReport(date, summaries);
			const key = `${REPORTS_PREFIX}${date}.json`;
			await blobs.put(key, encoder.encode(JSON.stringify(report)), JSON_TYPE);
			await store.put(REPORT_DATE_KEY, date);
			this.#log(`commute report ${key} written sessions=${report.sessions}`);
			return true;
		});
	}

	#exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.#queue.then(fn, fn);
		this.#queue = run.catch(() => undefined);
		return run;
	}

	#redact(text: string): string {
		let out = redactKeys(text, this.#secrets);
		for (const token of this.#tokensSeen) {
			const shown = `${token.slice(0, TOKEN_SHOWN_LENGTH)}…`;
			out = out.split(token).join(shown);
			out = out.split(encodeURIComponent(token)).join(shown);
		}
		return out
			.replace(KEY_QUERY, "$1<key>")
			.replace(SUBWAY_KEY_PATH, "$1<key>");
	}

	readonly #log = (line: string): void => {
		this.#ports.log(this.#redact(line));
	};

	#warnOnce(tag: string, line: string): void {
		if (!this.#warned.has(tag)) {
			this.#warned.add(tag);
			this.#log(line);
		}
	}

	async #routeView(route: Route, now: number): Promise<RouteView> {
		const { config } = this.#ports;
		const busRouteIds = new Set<string>();
		const busLines = new Set<LineRef>();
		const regional = new Map<LineRef, RegionalTarget>();
		const stations = new Set<string>();
		for (const leg of route.legs) {
			if (leg.mode === "bus") {
				busLines.add(leg.line);
				const routeId = seoulBusRouteIdOf(leg);
				const source = regionalSourceOf(leg);
				if (routeId !== null) {
					busRouteIds.add(routeId);
				} else if (source !== null) {
					addRegionalTarget(regional, leg, source, "board", false);
				}
			} else {
				stations.add(parseRef(leg.board.stop).id);
				stations.add(parseRef(leg.alight.stop).id);
			}
		}
		const raw: RawBoards = {
			bus: {},
			subway: {},
			timetable: await this.#timetableOf(subwayLegsIn(route.legs), now, now, {
				arrivals: {},
				rideMs: {},
			}),
		};
		await this.#collectStations([...stations], raw, now);
		await runLimited([...busRouteIds], 1, (routeId) =>
			this.#collectBus(routeId, false, raw, now, true, "map")
		);
		await this.#collectRegionalBus(
			[...regional.values()],
			raw,
			now,
			true,
			"map"
		);
		await this.#collectBusSchedules([...busLines], raw);
		const boards = assembleBoards(raw, config);
		const estimate = estimateRoute(
			route,
			boards,
			{
				fixed: route.legs.map(() => null),
				now,
				readyAt: now + (route.walkMinutes[0] ?? 0) * MINUTE_MS,
				skip: new Set(),
			},
			config
		);
		return {
			destinationEtaAt: estimate.destinationEtaAt,
			legs: route.legs.map((leg, index) =>
				routeViewLeg(estimate.legs[index], boards.board(leg, "board"))
			),
		};
	}

	async #tick(): Promise<{ nextAlarmAt: number }> {
		const { config, store } = this.#ports;
		const now = this.#ports.clock();
		await this.#startDue(now);
		const entries = await store.list<SessionEntry>(SESSION_PREFIX);
		const follows = await store.list<FollowEntry>(FOLLOW_PREFIX);
		let open = 0;
		let following = 0;
		let boundary: number | null = null;
		if (entries.size > 0 || follows.size > 0) {
			const plans = await this.#plansOf(entries);
			const raw = await this.#rawBoards(
				entries,
				plans,
				now,
				true,
				followLegs(follows)
			);
			const boards = assembleBoards(raw, config);
			// 한 세션씩 차례로 진행한다(JWT·액세스 토큰을 처음 만들 때 겹쳐 만들지 않게).
			await runLimited([...entries], 1, async ([key, entry]) => {
				const id = key.slice(SESSION_PREFIX.length);
				if (await this.#stepSafely(id, entry, plans, boards, now)) {
					open += 1;
					boundary = earlierOf(boundary, leaveBoundaryOf(entry, now));
				}
			});
			following = await this.#followUp(boards, now);
		}
		const busy = open + following;
		await this.#prune(now, busy);
		if (busy === 0) {
			return { nextAlarmAt: nextMinute(now) };
		}
		// 나가기 전 문장이 시계만으로 바뀌는 경계가 다음 tick보다 이르면 그때 깨어나 경계 푸시를 보낸다.
		return { nextAlarmAt: earlierOf(now + config.tickMs, boundary) };
	}

	async #stepSafely(
		id: string,
		entry: SessionEntry,
		plans: PlanLookup,
		boards: TransitBoards,
		now: number
	): Promise<boolean> {
		const record = plans.get(entry.state.planId);
		if (record === undefined) {
			// 경로를 읽지 못했다. 지운 것으로 보지 않고 다음 tick에 다시 본다.
			return true;
		}
		try {
			return await this.#step(id, entry, record, boards, now);
		} catch (error) {
			this.#log(`commute session=${id} step failed: ${errorText(error)}`);
			return true;
		}
	}

	async #input(
		installId: string,
		sessionId: string,
		input: SessionInput
	): Promise<InputResult> {
		const { config, store } = this.#ports;
		const key = sessionKey(sessionId);
		const entry = await store.get<SessionEntry>(key);
		if (!entry) {
			const mark = await store.get<EndedMark>(`${ENDED_PREFIX}${sessionId}`);
			return mark?.installId === installId ? "ended" : "not-found";
		}
		if (entry.installId !== installId) {
			return "not-found";
		}
		if (entry.state.stage === "ended") {
			return "ended";
		}
		const now = this.#ports.clock();
		const entries = new Map([[key, entry]]);
		const plans = await this.#plansOf(entries);
		const record = plans.get(entry.state.planId);
		if (record === undefined) {
			throw new Error("commute plan lookup failed");
		}
		// 입력은 버스를 새로 부르지 않고 저장해 둔 도착판으로 판단한다.
		const raw = await this.#rawBoards(entries, plans, now, false);
		await this.#step(
			sessionId,
			entry,
			record,
			assembleBoards(raw, config),
			now,
			input
		);
		return "ok";
	}

	// -------------------------------------------------------------------------
	// 예약

	async #startDue(now: number): Promise<void> {
		await runLimited(this.#ports.timezones, 1, async (timezone) => {
			let due: PlanRecord[];
			try {
				due = await this.#ports.plans.duePlans(
					timezone,
					startMinutesToCheck(now, timezone)
				);
			} catch (error) {
				this.#log(`commute due plans failed: ${errorText(error)}`);
				return;
			}
			await runLimited(due, 1, async ({ installId, plan }) => {
				try {
					await this.#maybeStart(installId, plan, now);
				} catch (error) {
					this.#log(
						`commute start plan=${plan.planId} failed: ${errorText(error)}`
					);
				}
			});
		});
	}

	async #maybeStart(
		installId: string,
		plan: CommutePlan,
		now: number
	): Promise<void> {
		const { plans, store } = this.#ports;
		if (!plan.enabled) {
			return;
		}
		// 시작 창(3분) 안에는 나가는 날이 하나뿐이라 공휴일은 찾은 날로 따로 본다.
		const due = dueStart(plan.schedule, now, () => false);
		if (due === null) {
			return;
		}
		const skipHoliday =
			!plan.schedule.includeHolidays &&
			(await plans.isHoliday(HOLIDAY_COUNTRY, due.serviceDate));
		if (skipHoliday) {
			return;
		}
		const sessionId = crypto.randomUUID();
		// 실패할 수 있는 조회는 D1 행을 열기 전에 한다. 연 뒤에 실패하면 그날 세션이 다시 열리지 않는다.
		const platform = platformOf(await this.#tokens(installId));
		const entry: SessionEntry = {
			dueAt: due.startAt,
			installId,
			lastContent: null,
			lastLeave: null,
			lastSentAt: null,
			platform,
			rejectedUpdates: 0,
			serviceDate: due.serviceDate,
			shownAt: null,
			startSentAt: null,
			state: startSession(plan, due, sessionId),
			timetable: { arrivals: {}, rideMs: {} },
			timetableAt: null,
			tokenAt: null,
			tokenWaitUntil: null,
			updatable: true,
		};
		const opened = await plans.openSession({
			id: sessionId,
			installId,
			planId: plan.planId,
			serviceDate: due.serviceDate,
			startedAt: now,
		});
		if (!opened) {
			return;
		}
		try {
			await store.put(sessionKey(sessionId), entry);
		} catch (error) {
			// 저장소에 세션이 없으면 아무도 닫지 않으니 D1 행을 여기서 닫는다.
			await plans.closeSession(sessionId, now, "no-token");
			throw error;
		}
		this.#log(
			`commute start session=${sessionId} plan=${plan.planId} platform=${platform ?? "none"}`
		);
		await this.#replaceOlder(installId, sessionId, now);
	}

	/**
	 * 잠금화면과 아일랜드의 안내는 기기마다 하나다. 새 세션을 연 뒤 같은 설치의 앞 세션에 종료를 보내고
	 * `replaced`로 닫는다. 예약 시각이 겹치는 경로가 둘이면 나중에 시작한 쪽만 남는다.
	 */
	async #replaceOlder(
		installId: string,
		keepId: string,
		now: number
	): Promise<void> {
		const { store } = this.#ports;
		const entries = await store.list<SessionEntry>(SESSION_PREFIX);
		const older = [...entries].filter(
			([key, entry]) =>
				entry.installId === installId &&
				entry.state.stage !== "ended" &&
				key !== sessionKey(keepId)
		);
		if (older.length === 0) {
			return;
		}
		const rows = await this.#tokens(installId);
		for (const [key, entry] of older) {
			const id = key.slice(SESSION_PREFIX.length);
			entry.state = endedState(entry.state, "replaced");
			try {
				// 앞 세션은 몇 개 안 되고, 하나씩 닫아야 같은 토큰 행을 겹쳐 지우지 않는다.
				// biome-ignore lint/performance/noAwaitInLoops: 차례대로 닫는다.
				await this.#finish(id, entry, null, rows, now);
			} catch (error) {
				this.#log(`commute session=${id} replace failed: ${errorText(error)}`);
			}
		}
	}

	async #plansOf(entries: Map<string, SessionEntry>): Promise<PlanLookup> {
		const planIds = new Set(
			[...entries.values()].map((entry) => entry.state.planId)
		);
		const found = await Promise.all(
			[...planIds].map(async (planId) => {
				try {
					return [planId, await this.#ports.plans.getPlan(planId)] as const;
				} catch (error) {
					this.#log(
						`commute plan=${planId} lookup failed: ${errorText(error)}`
					);
					return [planId, undefined] as const;
				}
			})
		);
		return new Map(found);
	}

	// -------------------------------------------------------------------------
	// 도착판

	async #rawBoards(
		entries: Map<string, SessionEntry>,
		plans: PlanLookup,
		now: number,
		pollBus: boolean,
		followed: Leg[] = []
	): Promise<RawBoards> {
		const raw: RawBoards = {
			bus: {},
			subway: {},
			timetable: { arrivals: {}, rideMs: {} },
		};
		const withPlans: [SessionEntry, CommutePlan][] = [];
		for (const entry of entries.values()) {
			const plan = plans.get(entry.state.planId)?.plan;
			if (plan) {
				withPlans.push([entry, plan]);
			}
		}
		const { busLines, busRoutes, regional, stations } = this.#boardTargets(
			withPlans,
			followed,
			now
		);
		await Promise.all(
			withPlans.map(([entry, plan]) => this.#refreshTimetable(entry, plan, now))
		);
		for (const [entry] of withPlans) {
			Object.assign(raw.timetable.arrivals, entry.timetable.arrivals);
			Object.assign(raw.timetable.rideMs, entry.timetable.rideMs);
		}
		await this.#collectStations([...stations], raw, now);
		// 노선은 차례로 부른다(하루 예산을 시도마다 센다).
		await runLimited([...busRoutes], 1, ([routeId, near]) =>
			this.#collectBus(routeId, near, raw, now, pollBus, "session")
		);
		await this.#collectRegionalBus(
			[...regional.values()],
			raw,
			now,
			pollBus,
			"session"
		);
		await this.#collectBusSchedules([...busLines], raw);
		return raw;
	}

	/**
	 * 이 tick에 볼 서울 버스 노선(가까운 차량 여부), 지역 버스 노선(정류장·위치 목록), 정적 일정을
	 * 읽을 버스 노선, 지하철역.
	 */
	#boardTargets(
		withPlans: [SessionEntry, CommutePlan][],
		followed: Leg[],
		now: number
	): BoardTargets {
		const targets: BoardTargets = {
			busLines: new Set(),
			busRoutes: new Map(),
			regional: new Map(),
			stations: new Set(),
		};
		const { stations } = targets;
		for (const [entry, plan] of withPlans) {
			const riding = ridingLeg(entry.state, plan);
			for (const leg of watchedLegs(entry.state, plan)) {
				if (leg.mode === "subway") {
					stations.add(parseRef(leg.board.stop).id);
					stations.add(parseRef(leg.alight.stop).id);
					continue;
				}
				const near = this.#isNear(entry, plan, leg.line, now);
				addBusTarget(targets, leg, leg === riding ? "alight" : "board", near);
			}
		}
		// 제안을 따라가는 구간은 하차 정류장만 본다(탈 차량이 가깝다고 보지 않는다).
		for (const leg of followed) {
			if (leg.mode === "subway") {
				stations.add(parseRef(leg.alight.stop).id);
				continue;
			}
			addBusTarget(targets, leg, "alight", false);
		}
		return targets;
	}

	/**
	 * 도착판이 없을 때의 추정에 쓰는 버스 노선의 정적 배차간격. 읽지 못하면 로그만 남기고
	 * 일정 없이 간다(한 tick의 모든 세션이 이 조회 하나에 막히지 않게).
	 */
	async #collectBusSchedules(lines: LineRef[], raw: RawBoards): Promise<void> {
		if (lines.length === 0) {
			return;
		}
		try {
			raw.busSchedules = await this.#ports.busSchedules(lines);
		} catch (error) {
			this.#log(`commute bus schedules failed: ${errorText(error)}`);
		}
	}

	/** 기본 경로의 지금 구간이 이 노선(전체 노선 ID)이고, 탑승 전이며, 잡은 차량이 가까운가. */
	#isNear(
		entry: SessionEntry,
		plan: CommutePlan,
		line: LineRef,
		now: number
	): boolean {
		const { state } = entry;
		if (!isBeforeBoarding(state)) {
			return false;
		}
		const leg = plan.routes.find((route) => route.rank === 0)?.legs[
			state.legIndex
		];
		if (leg?.mode !== "bus" || leg.line !== line) {
			return false;
		}
		const boardEtaAt =
			state.estimates.find((estimate) => estimate.rank === 0)?.legs[
				state.legIndex
			]?.boardEtaAt ?? null;
		return (
			boardEtaAt !== null &&
			boardEtaAt - now <= this.#ports.config.busNearWindowMs
		);
	}

	/** 지하철 구간의 시간표를 세션 시작 때와 그 뒤 10분마다 받아 세션 항목에 둔다. */
	async #refreshTimetable(
		entry: SessionEntry,
		plan: CommutePlan,
		now: number
	): Promise<void> {
		const fresh =
			entry.timetableAt !== null &&
			now - entry.timetableAt < TIMETABLE_REFRESH_MS;
		if (fresh) {
			return;
		}
		const rideAt = Math.max(now, entry.state.leaveAt);
		entry.timetable = await this.#timetableOf(
			subwayLegsOf(plan),
			now,
			rideAt,
			entry.timetable
		);
		entry.timetableAt = now;
	}

	/** 지하철 구간마다 승차역 시간표 도착과 주행 시간. 읽지 못한 구간은 `base`의 값을 둔다. */
	async #timetableOf(
		legs: SubwayLeg[],
		now: number,
		rideAt: number,
		base: RawBoards["timetable"]
	): Promise<RawBoards["timetable"]> {
		const { timetable } = this.#ports;
		const arrivals = { ...base.arrivals };
		const rideMs = { ...base.rideMs };
		await Promise.all(
			legs.map(async (leg) => {
				const key = legKey(leg);
				const line = parseRef(leg.line).id;
				const from = parseRef(leg.board.stop).id;
				const to = parseRef(leg.alight.stop).id;
				try {
					const [next, ride] = await Promise.all([
						timetable.nextArrivals(
							line,
							leg.direction,
							from,
							now,
							TIMETABLE_ARRIVALS
						),
						timetable.rideMs(line, leg.direction, from, to, rideAt),
					]);
					arrivals[key] = next;
					rideMs[key] = ride;
				} catch (error) {
					this.#log(`commute timetable ${line} failed: ${errorText(error)}`);
				}
			})
		);
		return { arrivals, rideMs };
	}

	async #collectStations(
		statnIds: string[],
		raw: RawBoards,
		now: number
	): Promise<void> {
		if (statnIds.length === 0) {
			return;
		}
		const { boards, config, store } = this.#ports;
		let rows: Record<string, StationEntry> = {};
		try {
			await boards.watch(statnIds, now + WATCH_MS);
			rows = await boards.stations(statnIds);
		} catch (error) {
			this.#log(`commute stations failed: ${errorText(error)}`);
		}
		await Promise.all(
			statnIds.map(async (statnId) => {
				const key = `${STATION_PREFIX}${statnId}`;
				let saved = (await store.get<StationSaved>(key)) ?? null;
				const fresh = rows[statnId];
				// 빈 응답은 돌리지 않는다(앞 열차가 모두 지난 것처럼 보인다). 앞 폴링이 묵었으면
				// 그 사이에 지난 열차를 알 수 없으므로 prev로 쓰지 않는다.
				const isNew =
					fresh !== undefined &&
					fresh.rows.length > 0 &&
					fresh.fetchedAt !== saved?.cur.fetchedAt;
				if (isNew) {
					const last = saved?.cur ?? null;
					const isConsecutive =
						last !== null &&
						fresh.fetchedAt - last.fetchedAt <= config.staleAfterMs;
					saved = { cur: fresh, prev: isConsecutive ? last : null };
					await store.put(key, saved);
				}
				if (saved) {
					raw.subway[statnId] = {
						fetchedAt: saved.cur.fetchedAt,
						prev: saved.prev?.rows ?? null,
						rows: saved.cur.rows,
					};
				}
			})
		);
	}

	/**
	 * 노선 전 정류장 도착. 그 노선의 탈 차량이 가까운 세션이 있으면 `busNearPollMs`,
	 * 아니면 `busPollMs`가 지났을 때만 부른다. 같은 노선은 세션이 여럿이어도, 지도의 경로 보기와
	 * 겹쳐도 한 번이다(캐시 `busRoute:<id>`를 함께 쓴다). 지도 용도가 세션 몫에 닿아 부르지 않았으면
	 * 폴링 시각을 찍지 않는다(찍으면 바로 뒤 세션 tick이 간격에 막힌다).
	 */
	async #collectBus(
		routeId: string,
		near: boolean,
		raw: RawBoards,
		now: number,
		poll: boolean,
		purpose: BusArrivalPurpose
	): Promise<void> {
		const { config, store } = this.#ports;
		const key = `${BUS_PREFIX}${routeId}`;
		let saved = (await store.get<BusRouteSaved>(key)) ?? null;
		const interval = near ? config.busNearPollMs : config.busPollMs;
		const isDue = saved === null || now - saved.polledAt >= interval;
		if (poll && isDue) {
			const stops = await this.#pollBus(routeId, now, purpose);
			// 지도 몫에 막혔으면 부르지 않았으니 캐시만 쓴다.
			if (stops !== RESERVED) {
				const data = stops
					? {
							fetchedAt: this.#ports.clock(),
							now: stops,
							prev: saved?.data?.now ?? null,
						}
					: (saved?.data ?? null);
				saved = { data, polledAt: now };
				await store.put(key, saved);
			}
		}
		if (saved?.data) {
			raw.bus[routeId] = saved.data;
		}
	}

	/** 시도마다 하루 예산 1건. 응답이 없으면 1초·2초 뒤 두 번까지 다시 부른다. */
	async #pollBus(
		routeId: string,
		now: number,
		purpose: BusArrivalPurpose
	): Promise<RouteStopArrival[] | null | typeof RESERVED> {
		const day = dayOf(now);
		if (
			(await this.#ports.store.get(`${STOPPED_PREFIX}${day}`)) !== undefined
		) {
			return null;
		}
		return await this.#attemptBus(routeId, day, now, 0, purpose);
	}

	async #attemptBus(
		routeId: string,
		day: string,
		now: number,
		attempt: number,
		purpose: BusArrivalPurpose
	): Promise<RouteStopArrival[] | null | typeof RESERVED> {
		const { boards, config, store } = this.#ports;
		const budgetKey = `${BUDGET_PREFIX}${day}`;
		const used = (await store.get<number>(budgetKey)) ?? 0;
		const mapLimit =
			config.dailyBudgetBusArrival - config.busArrivalSessionReserve;
		if (purpose === "map" && used >= mapLimit) {
			this.#warnOnce(
				`map-share:${day}`,
				`commute bus arrival map share exhausted day=${day} used=${used}`
			);
			return RESERVED;
		}
		if (used >= config.dailyBudgetBusArrival) {
			this.#warnOnce(
				`budget:${day}`,
				`commute bus arrival budget exhausted day=${day}`
			);
			return null;
		}
		await store.put(budgetKey, used + 1);
		try {
			const stops = await boards.busRoute(routeId);
			if (stops) {
				return stops;
			}
		} catch (error) {
			if (error instanceof UpstreamStoppedError) {
				await store.put(`${STOPPED_PREFIX}${day}`, {
					at: now,
					outcome: error.outcome,
				});
				this.#log(`commute bus arrival stopped for the day: ${error.outcome}`);
				return null;
			}
			this.#log(`commute bus arrival ${routeId} failed: ${errorText(error)}`);
			return null;
		}
		const backoff = RETRY_BACKOFF_MS[attempt];
		if (backoff === undefined) {
			this.#log(`commute bus arrival ${routeId} no response`);
			return null;
		}
		await this.#sleep(backoff);
		return await this.#attemptBus(routeId, day, now, attempt + 1, purpose);
	}

	/**
	 * 지역(GBIS·TAGO) 노선의 도착과 위치 목록. 노선마다 차례로 부른다(하루 예산을 시도마다 센다).
	 * 부르지 않는 걸음(`poll`이 false)도 저장해 둔 원자료는 싣는다.
	 */
	async #collectRegionalBus(
		targets: RegionalTarget[],
		raw: RawBoards,
		now: number,
		poll: boolean,
		purpose: BusArrivalPurpose
	): Promise<void> {
		if (targets.length === 0) {
			return;
		}
		const tagoLines = targets
			.filter((target) => target.source === "tago")
			.map((target) => target.line);
		const cities =
			poll && tagoLines.length > 0
				? await this.#citiesOf(tagoLines)
				: this.#cities;
		await runLimited(targets, 1, (target) =>
			this.#collectRegional(
				target,
				cities.get(target.line) ?? null,
				raw,
				now,
				poll,
				purpose
			)
		);
	}

	/** TAGO 노선의 도시 코드. 읽지 못하면 로그만 남기고 그 노선은 이번에 부르지 않는다. */
	async #citiesOf(lines: LineRef[]): Promise<Map<LineRef, string>> {
		const missing = lines.filter((line) => !this.#cities.has(line));
		if (missing.length === 0) {
			return this.#cities;
		}
		try {
			const found = await this.#ports.regionalRouteCities(missing);
			for (const line of missing) {
				const city = found[line];
				if (city !== null && city !== undefined) {
					this.#cities.set(line, city);
				}
			}
		} catch (error) {
			this.#log(`commute regional route cities failed: ${errorText(error)}`);
		}
		return this.#cities;
	}

	/**
	 * 지역 노선 하나. 서울처럼 탈 차량이 가까운 세션이 있으면 `busNearPollMs`, 아니면 `busPollMs`가
	 * 지났을 때만 부르고, 세션과 지도의 경로 보기가 캐시 `regionalBus:<노선>`을 함께 쓴다. 도시 코드가
	 * 없는 TAGO 노선은 부르지 않는다(배차간격 추정으로 둔다). 부르지 못했으면 직전 원자료를 그대로 둔다.
	 */
	async #collectRegional(
		target: RegionalTarget,
		cityCode: string | null,
		raw: RawBoards,
		now: number,
		poll: boolean,
		purpose: BusArrivalPurpose
	): Promise<void> {
		const { config, store } = this.#ports;
		const key = `${REGIONAL_PREFIX}${target.line}`;
		let saved = (await store.get<RegionalSaved>(key)) ?? null;
		const interval = target.near ? config.busNearPollMs : config.busPollMs;
		const isDue = saved === null || now - saved.polledAt >= interval;
		const isCallable = target.source === "gbis" || cityCode !== null;
		if (poll && isDue && isCallable) {
			const route: RegionalRouteRef = {
				cityCode,
				routeId: target.routeId,
				source: target.source,
			};
			const polled = await this.#pollRegional(
				route,
				target,
				saved?.data ?? null,
				now,
				purpose
			);
			// 지도 몫에 막혔으면 부르지 않았으니 캐시만 쓴다.
			if (polled !== RESERVED) {
				saved = { data: polled ?? saved?.data ?? null, polledAt: now };
				await store.put(key, saved);
			}
		}
		if (saved?.data) {
			raw.regionalBus = raw.regionalBus ?? {};
			raw.regionalBus[target.line] = saved.data;
		}
	}

	/**
	 * 정류장마다 도착 1건, 필요하면 위치 목록 1건을 부른다. 위치 목록은 탄 구간·따라가는 구간, TAGO
	 * 차량 번호 붙이기, 그리고 GBIS에서 직전 도착의 차량이 빠졌을 때(지났는지 보려고) 부른다.
	 * GBIS에서 빠진 차량이 지났는지 모르는 정류장은 직전 도착을 둔다(`unsettledStops`). 저장 전에
	 * 멈춘 차량을 뺀다. 부른 것이 모두 실패하면 null(직전 원자료를 둔다).
	 */
	async #pollRegional(
		route: RegionalRouteRef,
		target: RegionalTarget,
		prev: RegionalData | null,
		now: number,
		purpose: BusArrivalPurpose
	): Promise<RegionalData | null | typeof RESERVED> {
		const { boards, clock, config, store } = this.#ports;
		const base = { day: dayOf(now), now, purpose, source: route.source };
		const fetched: RouteStopArrival[] = [];
		let reserved = false;
		await runLimited([...target.stops.values()], 1, async (stop) => {
			const arrival = await this.#attemptRegional({
				...base,
				fetch: () => boards.regionalArrival(route, stop),
				op: "arrival",
			});
			if (arrival === RESERVED) {
				reserved = true;
			} else if (arrival !== null) {
				fetched.push(arrival);
			}
		});
		if (reserved && fetched.length === 0) {
			return RESERVED;
		}
		const needsLocations =
			target.locations ||
			(fetched.length > 0 &&
				(route.source === "tago" || vehicleLeft(prev, fetched)));
		let positions: RegionalPosition[] | null = null;
		let positionsAt = now;
		if (needsLocations) {
			const found = await this.#attemptRegional({
				...base,
				fetch: () => boards.regionalLocations(route),
				op: "location",
			});
			positions = found === RESERVED ? null : found;
			positionsAt = clock();
		}
		if (fetched.length === 0 && positions === null) {
			return null;
		}
		let bySeq: Record<string, number> = {};
		if (positions !== null) {
			bySeq = Object.fromEntries(
				positions.map((position) => [position.vehicleId, position.seq])
			);
		} else if (needsLocations) {
			// 직전 위치는 받은 시각을 그대로 지니고 묵음 기준까지만 잇는다. 그래야 받은 지 오래된 순번으로
			// 외삽한 하차 ETA가 새 값처럼 보이지 않는다.
			const carried = carriedPositions(prev, now, config.staleAfterMs);
			bySeq = carried?.positions ?? {};
			positionsAt = carried?.at ?? positionsAt;
		}
		// TAGO 도착에는 차량 ID가 없다. 위치 목록으로 붙이고, 없으면 `tago-pos:`다. 이번 위치 목록을 못
		// 읽었으면 묵음 기준 안의 직전 위치로 붙인다. 그래야 잡은 차량의 ID가 한 번 실패로 바뀌지 않는다.
		const arrivals =
			route.source === "tago"
				? fetched.map((arrival) =>
						matchTagoVehicles(arrival, positions ?? tagoPositionsOf(bySeq))
					)
				: fetched;
		const unsettled =
			route.source === "gbis"
				? unsettledStops(prev, arrivals, bySeq, positions !== null)
				: new Set<number>();
		const settled = arrivals.filter((stop) => !unsettled.has(stop.seq));
		// 이번에 부르지 못한 정류장과 빠진 차량이 지났는지 모르는 정류장은 직전 값을 둔다(묵음 기준은
		// 그 정류장의 madeAt으로 잰다).
		const fresh = new Set(settled.map((stop) => stop.seq));
		const kept = (prev?.now ?? []).filter(
			(stop) => target.stops.has(stop.seq) && !fresh.has(stop.seq)
		);
		const merged = [...kept, ...settled].sort((a, b) => a.seq - b.seq);
		// 순번이 5분 넘게 그대로인 차량은 도착과 위치 목록에서 뺀다(예측 초는 보지 않는다). 위치 목록은
		// 이번에 받은 것만 관측으로 센다.
		const seenKey = `${SEEN_PREFIX}${target.line}`;
		const seen = updateSeen(
			(await store.get<Record<string, VehicleSeen>>(seenKey)) ?? {},
			merged,
			now,
			positions === null ? undefined : bySeq
		);
		await store.put(seenKey, seen);
		const live = dropFrozen(merged, seen, now);
		const liveIds = new Set(
			live.flatMap((stop) => stop.vehicles.map((vehicle) => vehicle.vehicleId))
		);
		const frozen = new Set(
			merged
				.flatMap((stop) => stop.vehicles.map((vehicle) => vehicle.vehicleId))
				.filter((vehicleId) => !liveIds.has(vehicleId))
		);
		return {
			fetchedAt: clock(),
			now: live,
			positions: dropFrozenPositions(
				Object.fromEntries(
					Object.entries(bySeq).filter(([vehicleId]) => !frozen.has(vehicleId))
				),
				seen,
				now
			),
			positionsAt,
			prev: prev?.now ?? null,
		};
	}

	/**
	 * 지역 호출 한 번. 시도마다 그 출처·오퍼레이션의 하루 예산 1건을 쓰고, 응답이 없으면 한 번만 다시
	 * 부른다. 그날 멈출 오류는 그 출처만 멈춘다(`stopped:<source>:<day>`). 지도 용도는 예산의
	 * 3분의 1을 세션 몫으로 남긴다.
	 */
	async #attemptRegional<T>(
		call: RegionalCall<T>,
		attempt = 0
	): Promise<T | null | typeof RESERVED> {
		const { config, store } = this.#ports;
		const { day, now, op, purpose, source } = call;
		const stoppedKey = `${STOPPED_PREFIX}${source}:${day}`;
		if ((await store.get(stoppedKey)) !== undefined) {
			return null;
		}
		const budgetKey = `${BUDGET_PREFIX}${source}-${op}:${day}`;
		const limit = regionalBudgetOf(config, source, op);
		const used = (await store.get<number>(budgetKey)) ?? 0;
		const mapLimit = limit - Math.ceil(limit * REGIONAL_SESSION_SHARE);
		if (purpose === "map" && used >= mapLimit) {
			this.#warnOnce(
				`map-share:${source}-${op}:${day}`,
				`commute ${source} ${op} map share exhausted day=${day} used=${used}`
			);
			return RESERVED;
		}
		if (used >= limit) {
			this.#warnOnce(
				`budget:${source}-${op}:${day}`,
				`commute ${source} ${op} budget exhausted day=${day}`
			);
			return null;
		}
		await store.put(budgetKey, used + 1);
		try {
			const value = await call.fetch();
			if (value !== null) {
				return value;
			}
		} catch (error) {
			if (error instanceof UpstreamStoppedError) {
				await store.put(stoppedKey, { at: now, outcome: error.outcome });
				this.#log(`commute ${source} stopped for the day: ${error.outcome}`);
				return null;
			}
			this.#log(`commute ${source} ${op} failed: ${errorText(error)}`);
			return null;
		}
		const backoff = RETRY_BACKOFF_MS[attempt];
		if (attempt >= REGIONAL_RETRIES || backoff === undefined) {
			this.#log(`commute ${source} ${op} no response`);
			return null;
		}
		await this.#sleep(backoff);
		return await this.#attemptRegional(call, attempt + 1);
	}

	// -------------------------------------------------------------------------
	// 세션 한 걸음

	/** 단계를 진행하고 필요하면 보낸다. 세션이 아직 열려 있으면 true. */
	async #step(
		id: string,
		entry: SessionEntry,
		record: PlanRecord | null,
		boards: TransitBoards,
		now: number,
		input?: SessionInput
	): Promise<boolean> {
		try {
			return await this.#advanceAndSend(id, entry, record, boards, now, input);
		} finally {
			await this.#flush(id);
		}
	}

	async #advanceAndSend(
		id: string,
		entry: SessionEntry,
		record: PlanRecord | null,
		boards: TransitBoards,
		now: number,
		input: SessionInput | undefined
	): Promise<boolean> {
		const { config, store } = this.#ports;
		const owned =
			record !== null &&
			record.installId === entry.installId &&
			record.plan.enabled;
		const plan = owned ? record.plan : null;
		const prev = entry.state;
		entry.state = plan
			? advance(
					releaseVanishedRegional(entry.state, plan, boards),
					plan,
					boards,
					now,
					config,
					input
				)
			: endedState(entry.state, "plan-removed");
		if (plan) {
			const { timezone } = plan.schedule;
			this.#note(
				id,
				...recordsOf(prev, entry.state, boards, plan, now, timezone)
			);
			if (input) {
				this.#note(id, inputRecordOf(prev, entry.state, input, now));
			}
		}
		const rows = await this.#tokens(entry.installId);
		if (plan === null || entry.state.stage === "ended") {
			await this.#finish(id, entry, plan, rows, now);
			return false;
		}
		const content = buildContent(entry.state, plan, now, config);
		const lastSent = entry.lastContent;
		const closeWith =
			lastSent === null
				? await this.#start(id, entry, content, rows, now)
				: await this.#update(id, entry, content, rows, now);
		if (closeWith !== null) {
			entry.state = endedState(entry.state, closeWith);
			// 거절은 토큰 문제가 아니니 시작한 Activity·알림을 치우려고 종료를 한 번 보낸다.
			// 토큰이 없거나 죽었으면 보낼 곳이 없다.
			await (closeWith === "push-rejected"
				? this.#finish(id, entry, plan, rows, now)
				: this.#close(id, entry, rows, now));
			return false;
		}
		const isSent = entry.lastContent === content;
		if (isSent) {
			this.#afterLeaveSent(id, entry, content, plan);
		}
		const suggestion = isSent ? content.suggestion : null;
		if (suggestion && lastSent?.suggestion?.rank !== suggestion.rank) {
			await this.#suggested(id, entry, plan, suggestion.rank, now);
		}
		await store.put(sessionKey(id), entry);
		return true;
	}

	/**
	 * 값이 나갔다: 보낸 순간 safe 문장이었으면 조기 탑승 기준을 남기고(스펙 4.6), 문장이 바뀌었으면
	 * `leave` 기록을 남긴다(스펙 4.7). 도보가 끝난 뒤 처음 나간 값은 나가는 시각이 내려간 것이라
	 * `none` 기록이 한 번 남는다. 보내지 못한 값은 사용자가 보지 않았으니 부르지 않는다.
	 */
	#afterLeaveSent(
		id: string,
		entry: SessionEntry,
		content: ContentState,
		plan: CommutePlan
	): void {
		entry.state = earlyBoardAfterSend(entry.state, content, plan);
		const record = leaveRecordOf(
			entry.state,
			content,
			plan,
			this.#ports.config,
			entry.lastLeave ?? null
		);
		if (record === null) {
			return;
		}
		this.#note(id, record);
		entry.lastLeave = {
			safeLeaveAt: record.safeLeaveAt,
			shown: record.shown,
			vehicleId: record.vehicleId,
		};
	}

	/** 제안이 나갔다: 기록을 남기고 두 차량을 하차 정류장까지 따라가게 한다. */
	async #suggested(
		id: string,
		entry: SessionEntry,
		plan: CommutePlan,
		rank: number,
		now: number
	): Promise<void> {
		const found = suggestionRecordOf(entry.state, plan, rank, now);
		if (found === null) {
			return;
		}
		this.#note(id, found.record);
		const { store } = this.#ports;
		const follow = (await store.get<FollowEntry>(followKey(id))) ?? {
			items: [],
			serviceDate: entry.serviceDate,
			until: null,
		};
		for (const target of found.follow) {
			if (!follow.items.some((item) => sameTarget(item, target))) {
				follow.items.push({ ...target, done: false });
			}
		}
		await store.put(followKey(id), follow);
	}

	#note(id: string, ...records: AccuracyRecord[]): void {
		if (records.length === 0) {
			return;
		}
		const list = this.#pending.get(id) ?? [];
		list.push(...records);
		this.#pending.set(id, list);
	}

	/** 모은 기록을 DO 표에 쓴다. 실패해도 다음 걸음에 다시 쓰지 않는다(기록만 잃는다). */
	async #flush(id: string): Promise<void> {
		const list = this.#pending.get(id);
		this.#pending.delete(id);
		if (list === undefined || list.length === 0) {
			return;
		}
		try {
			await this.#ports.records.append(id, list);
		} catch (error) {
			this.#log(`commute session=${id} records failed: ${errorText(error)}`);
		}
	}

	#noteSend(
		id: string,
		content: ContentState,
		reason: string,
		outcome: SendOutcome,
		now: number
	): void {
		this.#note(id, {
			at: now,
			kind: "send",
			outcome,
			reason,
			seq: content.seq,
			sessionId: id,
		});
	}

	#sent(entry: SessionEntry, content: ContentState, now: number): void {
		entry.state = { ...entry.state, seq: content.seq };
		entry.lastContent = content;
		entry.lastSentAt = now;
	}

	/**
	 * 처음 보내는 세션. 닫아야 하면 그 이유를 돌려준다: 시작 토큰이 없거나 죽었으면 `no-token`,
	 * 토큰이 아닌 이유로 거절되면 `push-rejected`(다음 날 다시 시도된다). `retry`(429·5xx)는
	 * 받지 않은 것이 확실하니 다음 tick에 다시 보낸다.
	 *
	 * iOS는 응답을 받지 못한 시작(`unconfirmed`)을 다시 보내지 않는다. APNs가 이미 받았으면 Activity가
	 * 둘이 된다. 보낸 것으로 두고 정상 시작처럼 업데이트 토큰을 기다린다(안 오면 갱신 불가).
	 * Android는 같은 알림을 덮어쓰므로 `unconfirmed`도 다시 보낸다.
	 */
	async #start(
		id: string,
		entry: SessionEntry,
		content: ContentState,
		rows: PushTokenRow[],
		now: number
	): Promise<EndReason | null> {
		const { config, secrets } = this.#ports;
		if (entry.platform === "ios") {
			const row = latestToken(rows, (r) => r.kind === "apns-start");
			if (row === null) {
				return "no-token";
			}
			const outcome = await this.#sendApns(id, row, "start", (jwt) =>
				apnsStartRequest({
					attributes: activityAttributes(entry.state),
					env: row.env,
					jwt,
					now,
					staleAt: staleAtFor(content, now, config),
					state: content,
					token: row.token,
					topic: secrets.apnsTopic,
				})
			);
			this.#noteSend(id, content, "start", outcome, now);
			if (outcome === "ok" || outcome === "unconfirmed") {
				this.#sent(entry, content, now);
				entry.startSentAt = now;
				entry.tokenWaitUntil = now + config.tokenWaitMs;
			}
			return startCloseReason(outcome);
		}
		if (entry.platform === "android") {
			const row = latestToken(rows, (r) => r.kind === "fcm");
			if (row === null) {
				return "no-token";
			}
			const outcome = await this.#sendFcm(id, entry, row, "start", content);
			this.#noteSend(id, content, "start", outcome, now);
			if (outcome === "ok") {
				this.#sent(entry, content, now);
				entry.startSentAt = now;
			}
			return startCloseReason(outcome);
		}
		return "no-token";
	}

	/** 갱신이 `config`로 거절됐다. 세션당 상한에 닿았으면 true. */
	#rejectedUpdate(id: string, entry: SessionEntry): boolean {
		entry.rejectedUpdates = (entry.rejectedUpdates ?? 0) + 1;
		if (entry.rejectedUpdates < PUSH_REJECT_LIMIT) {
			return false;
		}
		this.#log(
			`commute session=${id} update rejected ${entry.rejectedUpdates} times, closing`
		);
		return true;
	}

	/**
	 * 갱신. iOS는 이 세션의 업데이트 토큰이 있어야 보낸다. 없으면 `tokenWaitUntil`까지 기다리고
	 * 지나면 `updatable: false`로 기록한다(시작은 다시 보내지 않는다). 토큰이 늦게라도 오면 보낸다.
	 * 보내지 못한 값(`retry`, `unconfirmed`, `config`)은 다음 tick에 다시 판단한다. `config`가
	 * `PUSH_REJECT_LIMIT`번 쌓이면 `push-rejected`로 닫는다.
	 */
	async #update(
		id: string,
		entry: SessionEntry,
		content: ContentState,
		rows: PushTokenRow[],
		now: number
	): Promise<EndReason | null> {
		const { config, secrets } = this.#ports;
		const decision = decideSend(
			entry.lastContent,
			content,
			entry.lastSentAt,
			now,
			config
		);
		if (entry.platform === "ios") {
			const row = this.#activityToken(id, entry, rows, now);
			if (row === null || !decision.send) {
				return null;
			}
			const outcome = await this.#sendApns(id, row, "update", (jwt) =>
				apnsUpdateRequest({
					env: row.env,
					jwt,
					now,
					priority: decision.priority,
					staleAt: staleAtFor(content, now, config),
					state: content,
					token: row.token,
					topic: secrets.apnsTopic,
				})
			);
			this.#noteSend(id, content, decision.reason, outcome, now);
			if (outcome === "ok") {
				this.#sent(entry, content, now);
			}
			// token-dead면 `#sendApns`가 업데이트 토큰을 지웠다. 세션은 열어 두고 갱신 불가로 간다.
			const isOverLimit =
				outcome === "config" && this.#rejectedUpdate(id, entry);
			return isOverLimit ? "push-rejected" : null;
		}
		const row = latestToken(rows, (r) => r.kind === "fcm");
		if (row === null) {
			return "no-token";
		}
		if (!decision.send) {
			return null;
		}
		const outcome = await this.#sendFcm(id, entry, row, "update", content);
		this.#noteSend(id, content, decision.reason, outcome, now);
		if (outcome === "ok") {
			this.#sent(entry, content, now);
		}
		if (outcome === "token-dead") {
			return "no-token";
		}
		const isOverLimit = outcome === "config" && this.#rejectedUpdate(id, entry);
		return isOverLimit ? "push-rejected" : null;
	}

	#activityToken(
		id: string,
		entry: SessionEntry,
		rows: PushTokenRow[],
		now: number
	): PushTokenRow | null {
		const row = latestToken(
			rows,
			(r) => r.kind === "apns-activity" && r.sessionId === id
		);
		if (row !== null) {
			entry.tokenAt ??= row.updatedAt;
			entry.updatable = true;
			return row;
		}
		const waited = entry.tokenWaitUntil !== null && now >= entry.tokenWaitUntil;
		if (waited && entry.updatable) {
			entry.updatable = false;
			this.#log(`commute session=${id} not updatable: no activity token`);
		}
		return null;
	}

	/** 끝: 시작한 Activity에 종료를 보내고 닫는다. */
	async #finish(
		id: string,
		entry: SessionEntry,
		plan: CommutePlan | null,
		rows: PushTokenRow[],
		now: number
	): Promise<void> {
		const last = entry.lastContent;
		if (last !== null) {
			const content = plan
				? buildContent(entry.state, plan, now, this.#ports.config)
				: endedContentFrom(last, entry.state, now);
			await this.#sendEnd(id, entry, content, rows, now);
		}
		await this.#close(id, entry, rows, now);
	}

	async #sendEnd(
		id: string,
		entry: SessionEntry,
		content: ContentState,
		rows: PushTokenRow[],
		now: number
	): Promise<void> {
		if (entry.platform === "ios") {
			const row = latestToken(
				rows,
				(r) => r.kind === "apns-activity" && r.sessionId === id
			);
			if (row === null) {
				return;
			}
			const outcome = await this.#sendApns(id, row, "end", (jwt) =>
				apnsEndRequest({
					env: row.env,
					jwt,
					now,
					state: content,
					token: row.token,
					topic: this.#ports.secrets.apnsTopic,
				})
			);
			this.#noteSend(id, content, "end", outcome, now);
			return;
		}
		const row = latestToken(rows, (r) => r.kind === "fcm");
		if (row !== null) {
			const outcome = await this.#sendFcm(id, entry, row, "end", content);
			this.#noteSend(id, content, "end", outcome, now);
		}
	}

	/** D1 세션을 닫고 이 세션의 업데이트 토큰과 저장소 항목을 지운다. */
	async #close(
		id: string,
		entry: SessionEntry,
		rows: PushTokenRow[],
		now: number
	): Promise<void> {
		const { plans, store, tokens } = this.#ports;
		const reason = entry.state.endReason ?? "user";
		try {
			await plans.closeSession(id, now, reason);
		} catch (error) {
			this.#log(`commute session=${id} close failed: ${errorText(error)}`);
		}
		await Promise.all(
			rows
				.filter((row) => row.kind === "apns-activity" && row.sessionId === id)
				.map((row) => tokens.remove(row.id))
		);
		await store.delete(sessionKey(id));
		const mark: EndedMark = { endedAt: now, installId: entry.installId };
		await store.put(`${ENDED_PREFIX}${id}`, mark);
		this.#log(`commute end session=${id} reason=${reason}`);
		// Task 11 전에 저장된 세션 항목에는 startSentAt이 없다.
		const startSentAt = entry.startSentAt ?? null;
		if (startSentAt !== null) {
			this.#note(id, {
				dueAt: entry.dueAt,
				kind: "start",
				sentAt: startSentAt,
				sessionId: id,
				shownAt: entry.shownAt,
				tokenAt: entry.tokenAt,
			});
		}
		this.#note(id, {
			at: now,
			boardedEarly: entry.state.boardedBy.includes("early"),
			kind: "end",
			planId: entry.state.planId,
			reason,
			sessionId: id,
		});
		await this.#flush(id);
		await this.#afterClose(id, entry.serviceDate, now);
	}

	/** 따라갈 차량이 남았으면 30분 기한을 걸고, 아니면 바로 요약해 쓴다. */
	async #afterClose(
		id: string,
		serviceDate: string,
		now: number
	): Promise<void> {
		const { store } = this.#ports;
		const follow = await store.get<FollowEntry>(followKey(id));
		if (follow?.items.some((item) => !item.done)) {
			await store.put(followKey(id), {
				...follow,
				until: now + FOLLOW_AFTER_END_MS,
			});
			return;
		}
		if (await this.#finalize(id, serviceDate)) {
			await store.delete(followKey(id));
			return;
		}
		// 쓰지 못했으면 다음 tick에 다시 쓴다.
		await store.put(followKey(id), { items: [], serviceDate, until: now });
	}

	/**
	 * 따라가는 차량이 하차 정류장을 지났으면 도착을 남긴다. 끝난 세션의 따라가기가 끝났으면
	 * (모두 닿았거나 기한이 지났으면) 요약해 쓰고 지운다. 남은 따라가기 수를 돌려준다.
	 */
	async #followUp(boards: TransitBoards, now: number): Promise<number> {
		const { records, store } = this.#ports;
		// 이번 tick의 세션 걸음이 더한 항목까지 보려고 다시 읽는다.
		const follows = await store.list<FollowEntry>(FOLLOW_PREFIX);
		let remaining = 0;
		await runLimited([...follows], 1, async ([key, follow]) => {
			const id = key.slice(FOLLOW_PREFIX.length);
			const arrivals: AccuracyRecord[] = [];
			for (const item of follow.items) {
				const arrival = item.done
					? null
					: arrivalRecordOf(
							id,
							item.leg,
							"alight",
							boards.board(item.leg, "alight"),
							item.vehicleId
						);
				if (arrival) {
					arrivals.push(arrival);
					item.done = true;
				}
			}
			try {
				if (arrivals.length > 0) {
					await records.append(id, arrivals);
					await store.put(key, follow);
				}
				const isOver =
					follow.until !== null &&
					(follow.items.every((item) => item.done) || now >= follow.until);
				if (isOver && (await this.#finalize(id, follow.serviceDate))) {
					await store.delete(key);
					return;
				}
			} catch (error) {
				this.#log(`commute follow session=${id} failed: ${errorText(error)}`);
			}
			remaining += 1;
		});
		return remaining;
	}

	/**
	 * 세션의 기록을 꺼내 요약하고 R2에 둘 다 쓴다. 쓰지 못하면 꺼낸 기록을 되돌려 놓고 false.
	 * 기록에는 설치 ID·토큰·키가 없다(세션 ID와 경로 ID, 교통 데이터뿐이다).
	 */
	async #finalize(id: string, serviceDate: string): Promise<boolean> {
		const { blobs, records } = this.#ports;
		let drained: AccuracyRecord[] = [];
		try {
			drained = await records.drain(id);
			const summary = summarize(drained);
			const lines = drained.map((record) => JSON.stringify(record)).join("\n");
			await blobs.put(
				`${RECORDS_PREFIX}${serviceDate}/${id}.ndjson.gz`,
				await gzip(drained.length > 0 ? `${lines}\n` : ""),
				GZIP_TYPE
			);
			await blobs.put(
				`${SUMMARIES_PREFIX}${serviceDate}/${id}.json`,
				encoder.encode(JSON.stringify(summary)),
				JSON_TYPE
			);
			this.#log(
				`commute records session=${id} written records=${drained.length} predictions=${summary.predictions.length}`
			);
			return true;
		} catch (error) {
			this.#log(`commute records session=${id} failed: ${errorText(error)}`);
			if (drained.length > 0) {
				await records.append(id, drained).catch((restoreError: unknown) => {
					this.#log(
						`commute records session=${id} restore failed: ${errorText(restoreError)}`
					);
				});
			}
			return false;
		}
	}

	// -------------------------------------------------------------------------
	// 푸시

	async #tokens(installId: string): Promise<PushTokenRow[]> {
		const rows = await this.#ports.tokens.tokens(installId);
		for (const row of rows) {
			this.#tokensSeen.add(row.token);
		}
		return rows;
	}

	/** 응답을 받지 못하면(예외, 타임아웃) null. 상대가 받았는지는 모른다. */
	async #push(request: Request): Promise<PushReply> {
		try {
			return await this.#ports.push.send(request);
		} catch (error) {
			this.#log(`commute push send failed: ${errorText(error)}`);
			return null;
		}
	}

	async #sendApns(
		id: string,
		row: PushTokenRow,
		event: "start" | "update" | "end",
		build: (jwt: string) => Request
	): Promise<SendOutcome> {
		const now = this.#ports.clock();
		let result = await this.#push(build(await this.#apnsJwt(now, false)));
		let outcome = outcomeOf(result, classifyApns);
		if (outcome === "jwt-expired") {
			// 서명 키는 그대로이니 새 JWT로 한 번만 다시 보낸다.
			result = await this.#push(build(await this.#apnsJwt(now, true)));
			outcome = renewedOutcome(outcomeOf(result, classifyApns));
		}
		if (outcome === "token-dead") {
			await this.#ports.tokens.remove(row.id);
		}
		this.#logPush(id, "apns", event, row, result, outcome);
		return outcome;
	}

	async #sendFcm(
		id: string,
		entry: SessionEntry,
		row: PushTokenRow,
		event: "start" | "update" | "end",
		content: ContentState
	): Promise<SendOutcome> {
		const now = this.#ports.clock();
		const build = (accessToken: string): Request =>
			fcmCommuteRequest({
				accessToken,
				event,
				planId: entry.state.planId,
				projectId: FCM_PROJECT_ID,
				sessionId: id,
				state: content,
				token: row.token,
			});
		let result = await this.#push(build(await this.#fcmAccess(now, false)));
		let outcome = outcomeOf(result, classifyFcm);
		if (outcome === "jwt-expired") {
			result = await this.#push(build(await this.#fcmAccess(now, true)));
			outcome = renewedOutcome(outcomeOf(result, classifyFcm));
		}
		if (outcome === "token-dead") {
			// 설치를 통째로 지우는 것은 UNREGISTERED뿐이다. INVALID_ARGUMENT는 본문 오류에도 나오니 그 토큰 행만 지운다.
			const unregistered =
				result?.status === FCM_UNREGISTERED_STATUS &&
				result.reason === "UNREGISTERED";
			await (unregistered
				? this.#ports.tokens.removeInstall(entry.installId)
				: this.#ports.tokens.remove(row.id));
		}
		this.#logPush(id, "fcm", event, row, result, outcome);
		return outcome;
	}

	#logPush(
		id: string,
		via: "apns" | "fcm",
		event: string,
		row: PushTokenRow,
		result: PushReply,
		outcome: SendOutcome
	): void {
		const status = result === null ? "none" : result.status;
		const reason = result?.reason ? ` reason=${result.reason}` : "";
		this.#log(
			`commute push ${event} session=${id} via=${via} env=${row.env} token=${row.token.slice(0, TOKEN_SHOWN_LENGTH)}… status=${status}${reason} outcome=${outcome}`
		);
	}

	/** 저장해 둔 APNs JWT(50분 안)를 다시 쓴다. 없거나 `force`면 새로 서명해 저장한다. */
	async #apnsJwt(now: number, force: boolean): Promise<string> {
		const { secrets, store } = this.#ports;
		const cache = await store.get<ApnsJwtCache>(APNS_JWT_KEY);
		const reusable = force ? null : reusableJwt(cache, now);
		if (reusable !== null) {
			return reusable;
		}
		const token = await apnsJwt(
			secrets.apnsP8,
			secrets.apnsKeyId,
			secrets.apnsTeamId,
			Math.floor(now / 1000)
		);
		const fresh: ApnsJwtCache = { issuedAt: now, token };
		await store.put(APNS_JWT_KEY, fresh);
		return token;
	}

	/** 저장해 둔 FCM 액세스 토큰을 만료 전까지 다시 쓴다. */
	async #fcmAccess(now: number, force: boolean): Promise<string> {
		const { push, store } = this.#ports;
		const cache = await store.get<{ expiresAt: number; token: string }>(
			FCM_ACCESS_KEY
		);
		if (!force && cache && cache.expiresAt > now) {
			return cache.token;
		}
		const fresh = await push.fcmAccessToken(now);
		await store.put(FCM_ACCESS_KEY, fresh);
		return fresh.token;
	}

	// -------------------------------------------------------------------------
	// 정리

	async #prune(now: number, open: number): Promise<void> {
		const { store } = this.#ports;
		const day = dayOf(now);
		const [ended, budgets, stops] = await Promise.all([
			store.list<EndedMark>(ENDED_PREFIX),
			store.list(BUDGET_PREFIX),
			store.list(STOPPED_PREFIX),
		]);
		const stale: string[] = [];
		for (const [key, mark] of ended) {
			if (now - mark.endedAt >= ENDED_KEEP_MS) {
				stale.push(key);
			}
		}
		// 예산·멈춤 키는 모두 `:<day>`로 끝난다(서울 `budget:<day>`, 지역 `budget:gbis-arrival:<day>`).
		const today = `:${day}`;
		for (const key of [...budgets.keys(), ...stops.keys()]) {
			if (!key.endsWith(today)) {
				stale.push(key);
			}
		}
		if (open === 0) {
			stale.push(...(await this.#staleBoards(now)));
		}
		await Promise.all(stale.map((key) => store.delete(key)));
	}

	/**
	 * 세션이 없을 때 지울 도착판 캐시. 세션이 없으면 도착판을 들고 있을 이유가 없다. 다만 지도의 경로
	 * 보기가 막 채운 캐시는 다음 경로 보기가 다시 부르지 않도록 간격(busPollMs)이나 묵음 기준 동안 둔다.
	 * 지역 노선의 멈춘 차량 기록은 그 노선 캐시와 함께 지운다.
	 */
	async #staleBoards(now: number): Promise<string[]> {
		const { config, store } = this.#ports;
		const [buses, stations, regionals, seens] = await Promise.all([
			store.list<BusRouteSaved>(BUS_PREFIX),
			store.list<StationSaved>(STATION_PREFIX),
			store.list<RegionalSaved>(REGIONAL_PREFIX),
			store.list(SEEN_PREFIX),
		]);
		const stale: string[] = [];
		const keptLines = new Set<string>();
		for (const [key, saved] of [...buses, ...regionals]) {
			if (now - saved.polledAt >= config.busPollMs) {
				stale.push(key);
			} else if (key.startsWith(REGIONAL_PREFIX)) {
				keptLines.add(key.slice(REGIONAL_PREFIX.length));
			}
		}
		for (const [key, saved] of stations) {
			if (now - saved.cur.fetchedAt >= config.staleAfterMs) {
				stale.push(key);
			}
		}
		for (const key of seens.keys()) {
			if (!keptLines.has(key.slice(SEEN_PREFIX.length))) {
				stale.push(key);
			}
		}
		return stale;
	}
}

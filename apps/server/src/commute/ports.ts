import type { AccuracyRecord } from "@Betro/commute/accuracy";
import type { CommuteConfig } from "@Betro/commute/config";
import type { CommutePlan } from "@Betro/commute/plan";
import type { LineRef } from "@Betro/commute/refs";
import type { EndReason } from "@Betro/commute/session/stage";
import type { BusSchedule } from "@Betro/commute/sources/bus-schedule";
import type {
	RegionalPosition,
	RegionalSource,
	RegionalStop,
} from "@Betro/commute/sources/regional-bus";
import type { RouteStopArrival } from "@Betro/commute/sources/seoul-bus";
import type {
	StationRow,
	TimetablePort,
} from "@Betro/commute/sources/seoul-subway";
import type { PushTokenRow } from "./auth";

/** 경로·예약·세션 기록(D1). */
export interface PlanStore {
	closeSession: (
		id: string,
		endedAt: number,
		reason: EndReason
	) => Promise<void>;
	/** 켜져 있고 그 시간대·시작 분에 해당하는 경로. */
	duePlans: (
		timezone: string,
		startMinutes: number[]
	) => Promise<{ installId: string; plan: CommutePlan }[]>;
	getPlan: (
		planId: string
	) => Promise<{ installId: string; plan: CommutePlan } | null>;
	isHoliday: (country: string, date: string) => Promise<boolean>;
	/** `(plan_id, service_date)`가 이미 있으면 false. */
	openSession: (row: {
		id: string;
		installId: string;
		planId: string;
		serviceDate: string;
		startedAt: number;
	}) => Promise<boolean>;
}

/** 푸시 토큰(D1). */
export interface TokenStore {
	remove: (id: number) => Promise<void>;
	/**
	 * 설치를 통째로 지운다(토큰, 경로, 세션 기록, 설치 행). FCM 토큰이 죽었을 때 쓴다.
	 * Android는 앱을 지우면 설치 ID가 사라져 서버 등록이 고아가 된다(5.2).
	 */
	removeInstall: (installId: string) => Promise<void>;
	tokens: (installId: string) => Promise<PushTokenRow[]>;
}

export interface PushResult {
	/** APNs `reason`, FCM 오류 코드(`UNREGISTERED` 등). 없으면 null. */
	reason: string | null;
	status: number;
}

/** APNs·FCM으로 요청을 보낸다. 연결 실패는 던진다(실행기가 다음 tick에 다시 보낸다). */
export interface PushSender {
	/** FCM HTTP v1 OAuth 액세스 토큰. 실행기가 `fcmAccess`에 담아 만료 전까지 다시 쓴다. */
	fcmAccessToken: (
		now: number
	) => Promise<{ expiresAt: number; token: string }>;
	send: (request: Request) => Promise<PushResult>;
}

/** 실행기 Durable Object 저장소. 값은 JSON으로 직렬화할 수 있어야 한다. */
export interface RunnerStore {
	delete: (key: string) => Promise<void>;
	get: <T>(key: string) => Promise<T | undefined>;
	list: <T>(prefix: string) => Promise<Map<string, T>>;
	put: (key: string, value: unknown) => Promise<void>;
}

/** 지역(GBIS·TAGO) 노선 하나. `routeId`는 맨 노선 ID, `cityCode`는 TAGO 도시 코드(GBIS는 null). */
export interface RegionalRouteRef {
	cityCode: string | null;
	routeId: string;
	source: RegionalSource;
}

/**
 * 도착판 원자료. `busRoute`·`regionalArrival`·`regionalLocations`는 상류를 한 번만 부른다(재시도와
 * 예산은 실행기가 센다). 응답을 받지 못했거나 잠깐의 오류(TAGO 게이트웨이 `04` 포함)면 null, 그날
 * 멈춰야 하는 오류(인증, 한도)는 `UpstreamStoppedError`를 던진다. 지역 도착에 차량이 없으면 null이
 * 아니라 빈 도착이다. TAGO 도착의 차량 ID는 비어 있다(실행기가 위치 목록으로 붙인다).
 */
export interface BoardSource {
	busRoute: (busRouteId: string) => Promise<RouteStopArrival[] | null>;
	regionalArrival: (
		route: RegionalRouteRef,
		stop: RegionalStop
	) => Promise<RouteStopArrival | null>;
	regionalLocations: (
		route: RegionalRouteRef
	) => Promise<RegionalPosition[] | null>;
	stations: (
		statnIds: string[]
	) => Promise<Record<string, { fetchedAt: number; rows: StationRow[] }>>;
	watch: (statnIds: string[], until: number) => Promise<void>;
}

/** 세션별 정확도 기록(DO SQLite 표). 메모리에 두지 않아 실행기가 다시 떠도 남는다. */
export interface RecordStore {
	append: (sessionId: string, records: AccuracyRecord[]) => Promise<void>;
	/** 그 세션의 기록을 쓴 순서대로 돌려주고 지운다. */
	drain: (sessionId: string) => Promise<AccuracyRecord[]>;
}

/** 기록·요약·일일 보고서를 두는 곳(R2 `betro-data`의 `commute/`). */
export interface CommuteBlobs {
	get: (key: string) => Promise<string | null>;
	/** 접두사로 시작하는 키 전부. */
	list: (prefix: string) => Promise<string[]>;
	put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
}

export interface RunnerSecrets {
	apnsKeyId: string;
	apnsP8: string;
	apnsTeamId: string;
	apnsTopic: string;
	fcmServiceAccountJson: string;
}

export interface RunnerPorts {
	blobs: CommuteBlobs;
	boards: BoardSource;
	/**
	 * 버스 노선의 정적 배차간격·첫차·막차(D1 현재 `bus_route` 배치). 키와 인자는 전체 노선 ID
	 * (`leg.line`)이고, 일정이 없는 노선은 빠진다. 도착판이 없을 때의 추정과, 응답에 배차간격이 없는
	 * GBIS·TAGO 도착판(또는 그 출처가 멈췄을 때)의 추정에 쓴다.
	 */
	busSchedules: (lines: string[]) => Promise<Record<string, BusSchedule>>;
	clock: () => number;
	config: CommuteConfig;
	log: (line: string) => void;
	plans: PlanStore;
	push: PushSender;
	records: RecordStore;
	/**
	 * 지역 노선(전체 노선 ID)의 TAGO 도시 코드(D1 현재 배치 `bus_route.source_city`). 배치에 없거나
	 * 도시 코드가 없으면 null이다. 도시 코드가 없는 TAGO 노선은 부르지 않는다.
	 */
	regionalRouteCities: (
		lines: LineRef[]
	) => Promise<Record<LineRef, string | null>>;
	secrets: RunnerSecrets;
	/** 상류 재시도 백오프. 테스트는 기다리지 않는다. 없으면 `setTimeout`. */
	sleep?: (ms: number) => Promise<void>;
	store: RunnerStore;
	timetable: TimetablePort;
	/** 예약을 확인할 시간대들. */
	timezones: string[];
	tokens: TokenStore;
}

/**
 * 그 출처를 그날 멈춰야 하는 상류 오류(401, 게이트웨이 인증·한도 오류). `source`는 멈출 출처다.
 * 출처마다 따로 멈춘다(GBIS 한도 초과가 서울 버스와 TAGO를 멈추지 않는다).
 */
export class UpstreamStoppedError extends Error {
	readonly outcome: "auth" | "quota-exhausted";
	readonly source: "seoul-bus" | RegionalSource;

	constructor(
		outcome: "auth" | "quota-exhausted",
		source: "seoul-bus" | RegionalSource = "seoul-bus"
	) {
		super(`upstream stopped: ${source} ${outcome}`);
		this.name = "UpstreamStoppedError";
		this.outcome = outcome;
		this.source = source;
	}
}

/** `PUSH_MODE=log`의 액세스 토큰 유효 시간(실제 토큰과 같은 50분). */
const LOG_ACCESS_TOKEN_MS = 50 * 60_000;

async function pushEventOf(request: Request): Promise<string> {
	try {
		const body = (await request.clone().json()) as {
			aps?: { event?: unknown };
			message?: { data?: { event?: unknown } };
		};
		const event = body.aps?.event ?? body.message?.data?.event;
		return typeof event === "string" ? event : "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * `PUSH_MODE=log`(로컬 기본): 보내지 않고 로그 한 줄만 남기고 200을 돌려준다.
 * 로그에는 사건과 호스트만 쓴다(토큰은 URL 경로·본문에 있어 쓰지 않는다).
 */
export function logPushSender(log: (line: string) => void): PushSender {
	return {
		fcmAccessToken: (now) =>
			Promise.resolve({ expiresAt: now + LOG_ACCESS_TOKEN_MS, token: "log" }),
		send: async (request) => {
			const event = await pushEventOf(request);
			log(`push (log) ${event} host=${new URL(request.url).host}`);
			return { reason: null, status: 200 };
		},
	};
}

import type { CommuteConfig } from "@Betro/commute/config";
import type { CommutePlan } from "@Betro/commute/plan";
import type { EndReason } from "@Betro/commute/session/stage";
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

/**
 * 도착판 원자료. `busRoute`는 상류를 한 번만 부른다(재시도와 예산은 실행기가 센다).
 * 응답을 받지 못했거나 잠깐의 오류면 null, 그날 멈춰야 하는 오류(인증, 한도)는
 * `UpstreamStoppedError`를 던진다.
 */
export interface BoardSource {
	busRoute: (busRouteId: string) => Promise<RouteStopArrival[] | null>;
	stations: (
		statnIds: string[]
	) => Promise<Record<string, { fetchedAt: number; rows: StationRow[] }>>;
	watch: (statnIds: string[], until: number) => Promise<void>;
}

export interface RunnerSecrets {
	apnsKeyId: string;
	apnsP8: string;
	apnsTeamId: string;
	apnsTopic: string;
	fcmServiceAccountJson: string;
}

export interface RunnerPorts {
	boards: BoardSource;
	clock: () => number;
	config: CommuteConfig;
	log: (line: string) => void;
	plans: PlanStore;
	push: PushSender;
	secrets: RunnerSecrets;
	/** 상류 재시도 백오프. 테스트는 기다리지 않는다. 없으면 `setTimeout`. */
	sleep?: (ms: number) => Promise<void>;
	store: RunnerStore;
	timetable: TimetablePort;
	/** 예약을 확인할 시간대들. */
	timezones: string[];
	tokens: TokenStore;
}

/** 그 출처를 그날 멈춰야 하는 상류 오류(401, 게이트웨이 인증·한도 오류). */
export class UpstreamStoppedError extends Error {
	readonly outcome: "auth" | "quota-exhausted";

	constructor(outcome: "auth" | "quota-exhausted") {
		super(`upstream stopped: ${outcome}`);
		this.name = "UpstreamStoppedError";
		this.outcome = outcome;
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

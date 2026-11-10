import type { AccuracyRecord } from "@Betro/commute/accuracy";
import { localToEpochMs } from "@Betro/commute/calendar";
import {
	type CommuteConfig,
	commuteConfig,
	DEFAULT_TIMEZONE,
} from "@Betro/commute/config";
import type { CommutePlan } from "@Betro/commute/plan";
import type { EndReason } from "@Betro/commute/session/stage";
import {
	parseRouteArrivals,
	type RouteStopArrival,
	routeArrivalsUrl,
} from "@Betro/commute/sources/seoul-bus";
import type { TimetablePort } from "@Betro/commute/sources/seoul-subway";
import { createD1Db, type Database } from "@Betro/db";
import {
	commutePlan,
	commuteSession,
	holiday,
	install,
	pushToken,
} from "@Betro/db/schema/commute";
import { fcmAccessTokenRequest } from "@Betro/realtime/alerts";
import { KOREAN_PUBLIC_HOLIDAYS } from "@Betro/realtime/holidays";
import { serviceDayAt } from "@Betro/realtime/time";
import type {
	D1Database,
	R2Bucket,
	SqlStorage,
} from "@cloudflare/workers-types";
import { and, eq, inArray } from "drizzle-orm";
import arrAll150Sample from "../../../../packages/commute/src/__fixtures__/arr-all-150.json";
import arrAll6411Sample from "../../../../packages/commute/src/__fixtures__/arr-all-6411.json";
import { liveUpstream } from "../collector/cf-ports";
import { collectorClient } from "../collector/client";
import type { Upstream } from "../collector/ports";
import { safeFetch } from "../collector/upstream-call";
import type { Env } from "../worker-env";
import type { PushTokenRow } from "./auth";
import {
	type BoardSource,
	type CommuteBlobs,
	logPushSender,
	type PlanStore,
	type PushResult,
	type PushSender,
	type RecordStore,
	type RunnerPorts,
	type RunnerStore,
	type TokenStore,
	UpstreamStoppedError,
} from "./ports";

/** APNs·FCM 요청 하나의 제한 시간. */
const PUSH_TIMEOUT_MS = 10_000;
/** OAuth 액세스 토큰(유효 1시간)을 다시 받기 전까지 쓰는 시간. */
const FCM_ACCESS_TOKEN_MS = 50 * 60_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;
const BUS_HEADER_TEMPORARY = "6";
const BUS_HEADER_AUTH = "7";
const BUS_HEADER_SERVICE_ENDED = "8";
/** 공공데이터포털 게이트웨이 초당 한도(잠깐 기다리면 된다). 그 밖의 게이트웨이 오류는 그날 멈춘다. */
const GATEWAY_RATE_LIMITED = "23";
const GATEWAY_QUOTA = "22";
const GATEWAY_REASON = /<returnReasonCode>\s*(\d+)\s*<\/returnReasonCode>/;
const SECOND_MS = 1000;

function attempt<T>(fn: () => T): Promise<T> {
	try {
		return Promise.resolve(fn());
	} catch (error) {
		return Promise.reject(error);
	}
}

// ---------------------------------------------------------------------------
// DO SQLite

/** 실행기 저장소. `kv` 표 하나에 JSON 값을 둔다. 생성자에서 표를 만든다. */
export class SqlRunnerStore implements RunnerStore {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
		);
	}

	get<T>(key: string): Promise<T | undefined> {
		return attempt(() => {
			const [row] = this.#sql
				.exec<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)
				.toArray();
			return row === undefined ? undefined : (JSON.parse(row.value) as T);
		});
	}

	put(key: string, value: unknown): Promise<void> {
		return attempt(() => {
			const text: string | undefined = JSON.stringify(value);
			if (value === undefined || text === undefined) {
				this.#sql.exec("DELETE FROM kv WHERE key = ?", key);
				return;
			}
			this.#sql.exec(
				"INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
				key,
				text
			);
		});
	}

	delete(key: string): Promise<void> {
		return attempt(() => {
			this.#sql.exec("DELETE FROM kv WHERE key = ?", key);
		});
	}

	list<T>(prefix: string): Promise<Map<string, T>> {
		return attempt(() => {
			const rows = this.#sql
				.exec<{ key: string; value: string }>(
					"SELECT key, value FROM kv WHERE substr(key, 1, ?) = ? ORDER BY key",
					prefix.length,
					prefix
				)
				.toArray();
			return new Map(
				rows.map((row) => [row.key, JSON.parse(row.value) as T] as const)
			);
		});
	}
}

/**
 * 정확도 기록 표(DO SQLite). 세션마다 쓴 순서(`id`)대로 꺼낸다. 메모리에 두지 않아 DO가
 * 잠들거나 다시 떠도 남는다. 생성자에서 표를 만든다.
 */
export class SqlRecordStore implements RecordStore {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS accuracy_record (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, body TEXT NOT NULL)"
		);
		sql.exec(
			"CREATE INDEX IF NOT EXISTS accuracy_record_session ON accuracy_record (session_id, id)"
		);
	}

	append(sessionId: string, records: AccuracyRecord[]): Promise<void> {
		return attempt(() => {
			for (const record of records) {
				this.#sql.exec(
					"INSERT INTO accuracy_record (session_id, body) VALUES (?, ?)",
					sessionId,
					JSON.stringify(record)
				);
			}
		});
	}

	drain(sessionId: string): Promise<AccuracyRecord[]> {
		return attempt(() => {
			const rows = this.#sql
				.exec<{ body: string }>(
					"SELECT body FROM accuracy_record WHERE session_id = ? ORDER BY id",
					sessionId
				)
				.toArray();
			this.#sql.exec(
				"DELETE FROM accuracy_record WHERE session_id = ?",
				sessionId
			);
			return rows.map((row) => JSON.parse(row.body) as AccuracyRecord);
		});
	}
}

// ---------------------------------------------------------------------------
// R2

/** `betro-data`의 출퇴근 기록·요약·보고서. */
export class R2CommuteBlobs implements CommuteBlobs {
	readonly #bucket: R2Bucket;

	constructor(bucket: R2Bucket) {
		this.#bucket = bucket;
	}

	async get(key: string): Promise<string | null> {
		const object = await this.#bucket.get(key);
		return object ? await object.text() : null;
	}

	/** 목록은 한 번에 1,000개까지라 커서를 따라 끝까지 읽는다. */
	async list(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		const page = async (cursor: string | undefined): Promise<void> => {
			const listed = await this.#bucket.list({ cursor, prefix });
			keys.push(...listed.objects.map((object) => object.key));
			if (listed.truncated) {
				await page(listed.cursor);
			}
		};
		await page(undefined);
		return keys;
	}

	async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
		await this.#bucket.put(key, body, { httpMetadata: { contentType } });
	}
}

// ---------------------------------------------------------------------------
// D1

/** 경로·세션·공휴일(D1). */
export class D1PlanStore implements PlanStore {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async duePlans(
		timezone: string,
		startMinutes: number[]
	): Promise<{ installId: string; plan: CommutePlan }[]> {
		if (startMinutes.length === 0) {
			return [];
		}
		const rows = await this.#db
			.select({ installId: commutePlan.installId, plan: commutePlan.planJson })
			.from(commutePlan)
			.where(
				and(
					eq(commutePlan.enabled, 1),
					eq(commutePlan.timezone, timezone),
					inArray(commutePlan.startMinute, startMinutes)
				)
			);
		return rows;
	}

	async getPlan(
		planId: string
	): Promise<{ installId: string; plan: CommutePlan } | null> {
		const [row] = await this.#db
			.select({ installId: commutePlan.installId, plan: commutePlan.planJson })
			.from(commutePlan)
			.where(eq(commutePlan.id, planId))
			.limit(1);
		return row ?? null;
	}

	/** `holiday` 표(임시공휴일 포함, Task 10이 채운다) 또는 고정 목록. */
	async isHoliday(country: string, date: string): Promise<boolean> {
		if (country === "KR" && KOREAN_PUBLIC_HOLIDAYS.has(date)) {
			return true;
		}
		const [row] = await this.#db
			.select({ date: holiday.date })
			.from(holiday)
			.where(and(eq(holiday.country, country), eq(holiday.date, date)))
			.limit(1);
		return row !== undefined;
	}

	async openSession(row: {
		id: string;
		installId: string;
		planId: string;
		serviceDate: string;
		startedAt: number;
	}): Promise<boolean> {
		const inserted = await this.#db
			.insert(commuteSession)
			.values({ ...row, status: "active" })
			.onConflictDoNothing()
			.returning({ id: commuteSession.id });
		return inserted.length > 0;
	}

	async closeSession(
		id: string,
		endedAt: number,
		reason: EndReason
	): Promise<void> {
		await this.#db
			.update(commuteSession)
			.set({ endedAt, endReason: reason, status: "ended" })
			.where(eq(commuteSession.id, id));
	}
}

/** 푸시 토큰(D1). */
export class D1TokenStore implements TokenStore {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async tokens(installId: string): Promise<PushTokenRow[]> {
		return await this.#db
			.select()
			.from(pushToken)
			.where(eq(pushToken.installId, installId));
	}

	async remove(id: number): Promise<void> {
		await this.#db.delete(pushToken).where(eq(pushToken.id, id));
	}

	/** `DELETE /v1/installs/me`와 같은 순서로 지운다(세션 기록에는 외래키가 없다). */
	async removeInstall(installId: string): Promise<void> {
		await this.#db.delete(pushToken).where(eq(pushToken.installId, installId));
		await this.#db
			.delete(commutePlan)
			.where(eq(commutePlan.installId, installId));
		await this.#db
			.delete(commuteSession)
			.where(eq(commuteSession.installId, installId));
		await this.#db.delete(install).where(eq(install.id, installId));
	}
}

/**
 * D1 지하철 시간표(`timetable_trip` ⋈ `timetable_stop_time`, 현재 배치). 정차 시각은 서비스일
 * 0시 기준 초이고, 서비스일과 요일 구분은 `serviceDayAt`(새벽 3시에 날이 바뀜)으로 정한다.
 */
export class D1Timetable implements TimetablePort {
	readonly #db: D1Database;

	constructor(db: D1Database) {
		this.#db = db;
	}

	async nextArrivals(
		line: string,
		direction: "up" | "down",
		statnId: string,
		fromMs: number,
		limit: number
	): Promise<{ at: number; tripId: number }[]> {
		const { dayStart, serviceDay } = serviceDayOf(fromMs);
		const { results } = await this.#db
			.prepare(
				`SELECT st.trip_id AS tripId, COALESCE(st.arrive_sec, st.depart_sec) AS sec
				   FROM timetable_stop_time st JOIN timetable_trip t ON t.id = st.trip_id
				  WHERE t.batch_id = (SELECT MAX(id) FROM reference_batch WHERE kind = 'timetable' AND is_current = 1)
				    AND t.line_key = ? AND t.direction = ? AND t.service_day = ? AND st.statn_id = ?
				    AND COALESCE(st.arrive_sec, st.depart_sec) >= ?
				  ORDER BY sec LIMIT ?`
			)
			.bind(
				line,
				direction,
				serviceDay,
				statnId,
				Math.floor((fromMs - dayStart) / SECOND_MS),
				limit
			)
			.all<{ sec: number; tripId: number }>();
		return results.map((row) => ({
			at: dayStart + row.sec * SECOND_MS,
			tripId: row.tripId,
		}));
	}

	async rideMs(
		line: string,
		direction: "up" | "down",
		fromStatnId: string,
		toStatnId: string,
		atMs: number
	): Promise<number | null> {
		const { dayStart, serviceDay } = serviceDayOf(atMs);
		const row = await this.#db
			.prepare(
				`SELECT COALESCE(b.arrive_sec, b.depart_sec) - COALESCE(a.depart_sec, a.arrive_sec) AS ride
				   FROM timetable_stop_time a
				   JOIN timetable_stop_time b ON b.trip_id = a.trip_id AND b.seq > a.seq
				   JOIN timetable_trip t ON t.id = a.trip_id
				  WHERE t.batch_id = (SELECT MAX(id) FROM reference_batch WHERE kind = 'timetable' AND is_current = 1)
				    AND t.line_key = ? AND t.direction = ? AND t.service_day = ?
				    AND a.statn_id = ? AND b.statn_id = ?
				    AND COALESCE(a.depart_sec, a.arrive_sec) >= ?
				  ORDER BY COALESCE(a.depart_sec, a.arrive_sec) LIMIT 1`
			)
			.bind(
				line,
				direction,
				serviceDay,
				fromStatnId,
				toStatnId,
				Math.floor((atMs - dayStart) / SECOND_MS)
			)
			.first<{ ride: number | null }>();
		return row?.ride === null || row?.ride === undefined || row.ride < 0
			? null
			: row.ride * SECOND_MS;
	}
}

function serviceDayOf(epochMs: number): {
	dayStart: number;
	serviceDay: string;
} {
	const { date, serviceDay } = serviceDayAt(epochMs);
	return { dayStart: localToEpochMs(date, 0, DEFAULT_TIMEZONE), serviceDay };
}

// ---------------------------------------------------------------------------
// 상류: 서울 버스 노선 전 정류장 도착

const NO_BUS_DATA = JSON.stringify({
	msgBody: { itemList: null },
	msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." },
});
const BUS_ROUTE_PARAM = /[?&]busRouteId=([^&]+)/;
const ARRIVAL_FIXTURES = new Map<string, string>([
	["100100029", JSON.stringify(arrAll150Sample)],
	["100100290", JSON.stringify(arrAll6411Sample)],
]);

/**
 * `UPSTREAM_MODE=fixture`: 상류를 부르지 않고 `packages/commute/src/__fixtures__`의
 * `getArrInfoByRouteAll` 표본을 돌려준다. 표본이 없는 노선은 "결과 없음"(headerCd 4).
 */
export const arrivalFixtureUpstream: Upstream = {
	fetch(url: string) {
		const routeId = BUS_ROUTE_PARAM.exec(url)?.[1];
		const body =
			(routeId === undefined ? undefined : ARRIVAL_FIXTURES.get(routeId)) ??
			NO_BUS_DATA;
		return Promise.resolve({ body, status: 200 });
	},
};

function parseJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return undefined;
	}
}

/**
 * 응답 하나 → 정류장 도착. 응답 없음·5xx·초당 한도·headerCd 6은 null(실행기가 다시 부른다),
 * 401·headerCd 7·게이트웨이 오류는 `UpstreamStoppedError`, headerCd 8(운행 끝)은 빈 목록.
 * 오류 문구에 URL을 넣지 않는다(키가 들어 있다).
 */
export function busArrivalsOf(response: {
	body: string;
	status: number | null;
}): RouteStopArrival[] | null {
	const { body, status } = response;
	if (status === null || status >= HTTP_SERVER_ERROR) {
		return null;
	}
	if (status === HTTP_UNAUTHORIZED) {
		throw new UpstreamStoppedError("auth");
	}
	if (status === HTTP_TOO_MANY) {
		throw new UpstreamStoppedError("quota-exhausted");
	}
	const gateway = GATEWAY_REASON.exec(body)?.[1];
	if (gateway === GATEWAY_RATE_LIMITED) {
		return null;
	}
	if (gateway !== undefined) {
		throw new UpstreamStoppedError(
			gateway === GATEWAY_QUOTA ? "quota-exhausted" : "auth"
		);
	}
	const parsed = parseRouteArrivals(parseJson(body));
	if (parsed.ok) {
		return parsed.stops;
	}
	switch (parsed.headerCd) {
		case BUS_HEADER_SERVICE_ENDED:
			return [];
		case BUS_HEADER_TEMPORARY:
			return null;
		case BUS_HEADER_AUTH:
			throw new UpstreamStoppedError("auth");
		default:
			throw new Error(
				`bus arrival request-error status=${status} headerCd=${parsed.headerCd ?? "none"}`
			);
	}
}

/** 버스는 상류를 직접(한 번만), 지하철은 수집기 RPC로. */
function boardSource(env: Env, upstream: Upstream): BoardSource {
	const collector = collectorClient(env);
	const key = env.DATA_GO_KR_API_KEY ?? "";
	return {
		busRoute: async (busRouteId) =>
			busArrivalsOf(
				await safeFetch(upstream, routeArrivalsUrl(key, busRouteId))
			),
		stations: (statnIds) => collector.stationRows(statnIds),
		watch: (statnIds, until) => collector.watchStations(statnIds, until),
	};
}

// ---------------------------------------------------------------------------
// 푸시

/** APNs `{ reason }`, FCM `{ error: { status, details: [{ errorCode }] } }`. */
function pushReasonOf(json: unknown): string | null {
	if (typeof json !== "object" || json === null) {
		return null;
	}
	const record = json as Record<string, unknown>;
	if (typeof record.reason === "string") {
		return record.reason;
	}
	const { error } = record;
	if (typeof error !== "object" || error === null) {
		return null;
	}
	const { details, status } = error as Record<string, unknown>;
	if (Array.isArray(details)) {
		for (const detail of details) {
			const code = (detail as Record<string, unknown> | null)?.errorCode;
			if (typeof code === "string") {
				return code;
			}
		}
	}
	return typeof status === "string" ? status : null;
}

function accessTokenOf(json: unknown): string | null {
	if (typeof json !== "object" || json === null) {
		return null;
	}
	const token = (json as Record<string, unknown>).access_token;
	return typeof token === "string" && token !== "" ? token : null;
}

/** `PUSH_MODE=send`: APNs·FCM에 실제로 보낸다. 오류 문구에는 HTTP 상태만 넣는다. */
function fetchPushSender(serviceAccountJson: string): PushSender {
	return {
		fcmAccessToken: async (now) => {
			const request = await fcmAccessTokenRequest(serviceAccountJson, now);
			const response = await fetch(request, {
				signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(`fcm token request failed: HTTP ${response.status}`);
			}
			const token = accessTokenOf(await response.json());
			if (token === null) {
				throw new Error("fcm token response had no access_token");
			}
			return { expiresAt: now + FCM_ACCESS_TOKEN_MS, token };
		},
		send: async (request): Promise<PushResult> => {
			let response: Response;
			try {
				response = await fetch(request, {
					signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
				});
			} catch (error) {
				// 연결 오류 문구에 URL(토큰)이 들어갈 수 있어 문구에는 종류만 남긴다.
				throw new Error(
					`push request failed: ${error instanceof Error ? error.name : "unknown"}`,
					{ cause: error }
				);
			}
			const text = await response.text().catch(() => "");
			return {
				reason: response.ok ? null : pushReasonOf(parseJson(text)),
				status: response.status,
			};
		},
	};
}

// ---------------------------------------------------------------------------
// 설정

/** `COMMUTE_*` 문자열 변수만 고른다. */
function commuteEnv(env: Env): Record<string, string | undefined> {
	const picked: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(env)) {
		if (name.startsWith("COMMUTE_") && typeof value === "string") {
			picked[name] = value;
		}
	}
	return picked;
}

/** 예약을 확인할 시간대. `COMMUTE_TIMEZONES`(쉼표로 구분), 없으면 기본 시간대 하나. */
function timezonesOf(env: Env): string[] {
	const listed = (env.COMMUTE_TIMEZONES ?? "")
		.split(",")
		.map((zone) => zone.trim())
		.filter((zone) => zone !== "");
	return listed.length > 0 ? listed : [DEFAULT_TIMEZONE];
}

export function runnerConfig(env: Env): CommuteConfig {
	return commuteConfig(commuteEnv(env));
}

/** Durable Object가 `RunnerCore`에 넣는 포트. */
export function runnerPorts(
	env: Env,
	storage: { records: RecordStore; store: RunnerStore },
	log: (line: string) => void
): { mode: { push: string; upstream: string }; ports: RunnerPorts } {
	const { records, store } = storage;
	const db = createD1Db(env.DB);
	const pushMode = env.PUSH_MODE === "send" ? "send" : "log";
	const upstreamMode = env.UPSTREAM_MODE === "live" ? "live" : "fixture";
	const serviceAccountJson = env.FCM_SERVICE_ACCOUNT_JSON ?? "";
	return {
		mode: { push: pushMode, upstream: upstreamMode },
		ports: {
			blobs: new R2CommuteBlobs(env.DATA),
			boards: boardSource(
				env,
				upstreamMode === "live" ? liveUpstream : arrivalFixtureUpstream
			),
			clock: () => Date.now(),
			config: runnerConfig(env),
			log,
			plans: new D1PlanStore(db),
			push:
				pushMode === "send"
					? fetchPushSender(serviceAccountJson)
					: logPushSender(log),
			records,
			secrets: {
				apnsKeyId: env.APNS_KEY_ID ?? "",
				apnsP8: env.APNS_KEY_P8 ?? "",
				apnsTeamId: env.APNS_TEAM_ID ?? "",
				apnsTopic: env.APNS_TOPIC ?? "",
				fcmServiceAccountJson: serviceAccountJson,
			},
			store,
			timetable: new D1Timetable(env.DB),
			timezones: timezonesOf(env),
			tokens: new D1TokenStore(db),
		},
	};
}

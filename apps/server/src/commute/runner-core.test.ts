import type { AccuracyRecord, SessionSummary } from "@Betro/commute/accuracy";
import {
	type CommuteConfig,
	commuteConfig,
	DEFAULT_TIMEZONE,
} from "@Betro/commute/config";
import type { CommutePlan } from "@Betro/commute/plan";
import type { ContentState } from "@Betro/commute/session/content";
import type { EndReason } from "@Betro/commute/session/stage";
import type { RouteStopArrival } from "@Betro/commute/sources/seoul-bus";
import type {
	StationRow,
	TimetablePort,
} from "@Betro/commute/sources/seoul-subway";
import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import type { PushTokenRow } from "./auth";
import {
	type BoardSource,
	type CommuteBlobs,
	logPushSender,
	type PlanStore,
	type PushResult,
	type PushSender,
	type RecordStore,
	type RunnerStore,
	type TokenStore,
	UpstreamStoppedError,
} from "./ports";
import { startMinuteOf } from "./routes";
import {
	commuteReportDate,
	RunnerCore,
	type SessionEntry,
} from "./runner-core";

const SECOND = 1000;
const MINUTE = 60_000;
/** 07:55 KST, 2026-11-10(화). 나가는 시각 08:05의 10분 전이다. */
const T0 = Date.UTC(2026, 10, 9, 22, 55);
const SERVICE_DATE = "2026-11-10";
const ROUTE_ID = "100100290";
const ALT_ROUTE_ID = "100100029";
const BOARD_SEQ = 30;
const ALIGHT_SEQ = 40;
const LAST_SEQ = 50;
const SEC_PER_STOP = 60;
const HEADWAY_MIN = 12;
/** V1은 08:11:24에 승차 정류장(순번 30)에 닿는다. 07:55에 순번 13.6에 있다. */
const V1_AT_BOARD = T0 + 984 * SECOND;
const V2_AT_BOARD = T0 + 1704 * SECOND;

const API_KEY = "TEST-API-KEY-0123456789abcdef";
const INSTALL_SECRET = "install-secret-must-never-appear-0001";
const IOS_INSTALL = "aaaaaaaa-0000-4000-8000-000000000001";
const IOS_INSTALL_2 = "aaaaaaaa-0000-4000-8000-000000000004";
const ANDROID_INSTALL = "aaaaaaaa-0000-4000-8000-000000000002";
const ANDROID_INSTALL_2 = "aaaaaaaa-0000-4000-8000-000000000003";
const OTHER_INSTALL = "aaaaaaaa-0000-4000-8000-0000000000ff";
const PLAN_IOS = "bbbbbbbb-0000-4000-8000-000000000001";
const PLAN_IOS_2 = "bbbbbbbb-0000-4000-8000-000000000004";
const PLAN_ANDROID = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAN_ANDROID_2 = "bbbbbbbb-0000-4000-8000-000000000003";
const START_TOKEN = "apnsstarttoken0123456789abcdef0123456789abcdef";
const START_TOKEN_2 = "apnsstarttoken2222222222abcdef0123456789abcdef";
const ACTIVITY_TOKEN = "apnsactivitytoken0123456789abcdef0123456789ab";
const FCM_TOKEN = "fcmtoken0123456789abcdef0123456789abcdef012345";
const FCM_TOKEN_2 = "fcmtoken2222222222abcdef0123456789abcdef012345";
const SA_PRIVATE_LINE =
	"MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDfakefake";
const FAKE_SERVICE_ACCOUNT = JSON.stringify({
	client_email: "commute@betro.iam.gserviceaccount.com",
	private_key: `-----BEGIN PRIVATE KEY-----\n${SA_PRIVATE_LINE}\n-----END PRIVATE KEY-----\n`,
});

let p8Pem = "";
let p8Body = "";

beforeAll(async () => {
	const pair = await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"]
	);
	const der = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey)
	);
	let binary = "";
	for (const byte of der) {
		binary += String.fromCharCode(byte);
	}
	p8Body = btoa(binary);
	p8Pem = `-----BEGIN PRIVATE KEY-----\n${p8Body}\n-----END PRIVATE KEY-----\n`;
});

// ---------------------------------------------------------------------------
// 가짜 포트

const GANGNAM = "1002000222";

/** 2호선 강남 → 역삼(외선) 한 구간. */
function makeSubwayPlan(planId: string): CommutePlan {
	const plan = makePlan(planId);
	plan.routes = [
		{
			legs: [
				{
					alight: { name: "역삼", stop: "seoul-subway:1002000221" },
					board: { name: "강남", stop: `seoul-subway:${GANGNAM}` },
					direction: "down",
					line: "seoul-subway:line2",
					lineName: "2호선",
					mode: "subway",
				},
			],
			rank: 0,
			walkMinutes: [5, 3],
		},
	];
	return plan;
}

function makePlan(
	planId: string,
	overrides: { includeHolidays?: boolean } = {}
): CommutePlan {
	return {
		enabled: true,
		planId,
		routes: [
			{
				legs: [
					{
						alight: {
							name: "고속터미널",
							seq: ALIGHT_SEQ,
							stop: "seoul-bus:119000040",
						},
						board: {
							name: "노량진역",
							seq: BOARD_SEQ,
							stop: "seoul-bus:119000030",
						},
						line: `seoul-bus:${ROUTE_ID}`,
						lineName: "6411",
						mode: "bus",
					},
				],
				rank: 0,
				walkMinutes: [5, 3],
			},
		],
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: overrides.includeHolidays ?? false,
			leadMinutes: 10,
			leaveMinute: 485,
			timezone: DEFAULT_TIMEZONE,
		},
	};
}

interface SimVehicle {
	arriveBoardAt: number;
	id: string;
}

/** 차량이 정류장 하나를 `SEC_PER_STOP`초에 지나는 노선 전 정류장 도착. */
function routeStops(
	vehicles: readonly SimVehicle[],
	at: number,
	madeAt: number
): RouteStopArrival[] {
	const stops: RouteStopArrival[] = [];
	for (let seq = 1; seq <= LAST_SEQ; seq += 1) {
		const near = vehicles
			.map((vehicle) => ({
				p: BOARD_SEQ - (vehicle.arriveBoardAt - at) / (SEC_PER_STOP * SECOND),
				vehicle,
			}))
			.filter((entry) => entry.p < seq)
			.sort((a, b) => b.p - a.p)
			.slice(0, 2);
		stops.push({
			headwayMin: HEADWAY_MIN,
			madeAt,
			seq,
			stopId: `1190000${seq}`,
			vehicles: near.map(({ p, vehicle }) => ({
				etaSec: Math.round((seq - p) * SEC_PER_STOP),
				isArrived: false,
				lastOfDay: false,
				plate: `서울74사${vehicle.id}`,
				seqNow: Math.floor(p),
				vehicleId: vehicle.id,
			})),
		});
	}
	return stops;
}

class MemoryStore implements RunnerStore {
	readonly data = new Map<string, string>();

	get<T>(key: string): Promise<T | undefined> {
		const text = this.data.get(key);
		return Promise.resolve(
			text === undefined ? undefined : (JSON.parse(text) as T)
		);
	}

	put(key: string, value: unknown): Promise<void> {
		this.data.set(key, JSON.stringify(value));
		return Promise.resolve();
	}

	delete(key: string): Promise<void> {
		this.data.delete(key);
		return Promise.resolve();
	}

	list<T>(prefix: string): Promise<Map<string, T>> {
		const out = new Map<string, T>();
		for (const [key, text] of this.data) {
			if (key.startsWith(prefix)) {
				out.set(key, JSON.parse(text) as T);
			}
		}
		return Promise.resolve(out);
	}
}

/** DO SQLite 기록 표 대신. 실행기를 새로 만들어도 남는다. */
class MemoryRecords implements RecordStore {
	readonly rows = new Map<string, AccuracyRecord[]>();

	append(sessionId: string, records: AccuracyRecord[]): Promise<void> {
		const rows = this.rows.get(sessionId) ?? [];
		this.rows.set(sessionId, [...rows, ...structuredClone(records)]);
		return Promise.resolve();
	}

	drain(sessionId: string): Promise<AccuracyRecord[]> {
		const rows = this.rows.get(sessionId) ?? [];
		this.rows.delete(sessionId);
		return Promise.resolve(rows);
	}
}

/** R2 대신. 쓴 키를 순서대로 남긴다. */
class MemoryBlobs implements CommuteBlobs {
	readonly objects = new Map<string, { body: Uint8Array; type: string }>();
	readonly puts: string[] = [];

	get(key: string): Promise<string | null> {
		const found = this.objects.get(key);
		return Promise.resolve(found ? new TextDecoder().decode(found.body) : null);
	}

	list(prefix: string): Promise<string[]> {
		return Promise.resolve(
			[...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort()
		);
	}

	put(key: string, body: Uint8Array, contentType: string): Promise<void> {
		this.puts.push(key);
		this.objects.set(key, { body, type: contentType });
		return Promise.resolve();
	}
}

interface SessionRow {
	endedAt: number | null;
	endReason: EndReason | null;
	id: string;
	installId: string;
	planId: string;
	serviceDate: string;
	startedAt: number;
	status: "active" | "ended";
}

/** D1 대신: 설치·경로·세션·공휴일·토큰. */
class FakeDb implements PlanStore, TokenStore {
	readonly holidays = new Set<string>();
	readonly installs = new Set<string>();
	readonly plans = new Map<string, { installId: string; plan: CommutePlan }>();
	readonly sessions = new Map<string, SessionRow>();
	tokenRows: PushTokenRow[] = [];
	#nextTokenId = 1;

	addPlan(installId: string, plan: CommutePlan): void {
		this.installs.add(installId);
		this.plans.set(plan.planId, { installId, plan });
	}

	addToken(
		installId: string,
		kind: PushTokenRow["kind"],
		token: string,
		options: { env?: PushTokenRow["env"]; sessionId?: string } = {}
	): PushTokenRow {
		const row: PushTokenRow = {
			activityId: options.sessionId ?? "",
			env: options.env ?? "sandbox",
			id: this.#nextTokenId,
			installId,
			kind,
			sessionId: options.sessionId ?? "",
			token,
			updatedAt: T0,
		};
		this.#nextTokenId += 1;
		this.tokenRows.push(row);
		return row;
	}

	duePlans(
		timezone: string,
		startMinutes: number[]
	): Promise<{ installId: string; plan: CommutePlan }[]> {
		const due = [...this.plans.values()].filter(
			({ plan }) =>
				plan.enabled &&
				plan.schedule.timezone === timezone &&
				startMinutes.includes(
					startMinuteOf(plan.schedule.leaveMinute, plan.schedule.leadMinutes)
				)
		);
		return Promise.resolve(structuredClone(due));
	}

	getPlan(
		planId: string
	): Promise<{ installId: string; plan: CommutePlan } | null> {
		const found = this.plans.get(planId);
		return Promise.resolve(found ? structuredClone(found) : null);
	}

	isHoliday(_country: string, date: string): Promise<boolean> {
		return Promise.resolve(this.holidays.has(date));
	}

	openSession(row: {
		id: string;
		installId: string;
		planId: string;
		serviceDate: string;
		startedAt: number;
	}): Promise<boolean> {
		const exists = [...this.sessions.values()].some(
			(s) => s.planId === row.planId && s.serviceDate === row.serviceDate
		);
		if (exists) {
			return Promise.resolve(false);
		}
		this.sessions.set(row.id, {
			...row,
			endedAt: null,
			endReason: null,
			status: "active",
		});
		return Promise.resolve(true);
	}

	closeSession(id: string, endedAt: number, reason: EndReason): Promise<void> {
		const row = this.sessions.get(id);
		if (row) {
			this.sessions.set(id, {
				...row,
				endedAt,
				endReason: reason,
				status: "ended",
			});
		}
		return Promise.resolve();
	}

	tokens(installId: string): Promise<PushTokenRow[]> {
		return Promise.resolve(
			structuredClone(this.tokenRows.filter((r) => r.installId === installId))
		);
	}

	remove(id: number): Promise<void> {
		this.tokenRows = this.tokenRows.filter((r) => r.id !== id);
		return Promise.resolve();
	}

	removeInstall(installId: string): Promise<void> {
		this.tokenRows = this.tokenRows.filter((r) => r.installId !== installId);
		for (const [planId, entry] of this.plans) {
			if (entry.installId === installId) {
				this.plans.delete(planId);
			}
		}
		for (const [id, row] of this.sessions) {
			if (row.installId === installId) {
				this.sessions.delete(id);
			}
		}
		this.installs.delete(installId);
		return Promise.resolve();
	}
}

interface SentRequest {
	body: Record<string, unknown>;
	headers: Record<string, string>;
	url: string;
}

class FakePush implements PushSender {
	readonly sent: SentRequest[] = [];
	respond: (sent: SentRequest) => PushResult | Error = () => ({
		reason: null,
		status: 200,
	});
	accessTokenCalls = 0;

	async send(request: Request): Promise<PushResult> {
		const sent: SentRequest = {
			body: JSON.parse(await request.text()) as Record<string, unknown>,
			headers: Object.fromEntries(request.headers.entries()),
			url: request.url,
		};
		this.sent.push(sent);
		const result = this.respond(sent);
		if (result instanceof Error) {
			throw result;
		}
		return result;
	}

	fcmAccessToken(now: number): Promise<{ expiresAt: number; token: string }> {
		this.accessTokenCalls += 1;
		return Promise.resolve({
			expiresAt: now + 50 * MINUTE,
			token: `access-${this.accessTokenCalls}`,
		});
	}
}

class FakeBoards implements BoardSource {
	readonly busCalls: string[] = [];
	readonly watched: string[][] = [];
	vehicles: SimVehicle[] = [
		{ arriveBoardAt: V1_AT_BOARD, id: "V1" },
		{ arriveBoardAt: V2_AT_BOARD, id: "V2" },
	];
	/** 정하면 도착판이 그 시각에서 멈춘다(같은 sourceAt). */
	frozenAt: number | null = null;
	handler: ((routeId: string) => RouteStopArrival[] | null | Error) | null =
		null;
	readonly #clock: { now: number };

	constructor(clock: { now: number }) {
		this.#clock = clock;
	}

	busRoute(busRouteId: string): Promise<RouteStopArrival[] | null> {
		this.busCalls.push(busRouteId);
		const handled = this.handler?.(busRouteId);
		if (handled instanceof Error) {
			return Promise.reject(handled);
		}
		if (handled !== undefined) {
			return Promise.resolve(handled);
		}
		const at = this.frozenAt ?? this.#clock.now;
		return Promise.resolve(routeStops(this.vehicles, at, at));
	}

	/** 수집기가 남긴 역 행. 키는 `statnId`. */
	stationRows: Record<string, { fetchedAt: number; rows: StationRow[] }> = {};

	stations(
		statnIds: string[]
	): Promise<Record<string, { fetchedAt: number; rows: StationRow[] }>> {
		return Promise.resolve(
			Object.fromEntries(
				statnIds.flatMap((statnId) => {
					const entry = this.stationRows[statnId];
					return entry ? [[statnId, entry]] : [];
				})
			)
		);
	}

	watch(statnIds: string[]): Promise<void> {
		this.watched.push(statnIds);
		return Promise.resolve();
	}
}

const emptyTimetable: TimetablePort = {
	nextArrivals: () => Promise.resolve([]),
	rideMs: () => Promise.resolve(null),
};

function harness(overrides: Partial<CommuteConfig> = {}) {
	const clock = { now: T0 };
	const logs: string[] = [];
	const store = new MemoryStore();
	const db = new FakeDb();
	const push = new FakePush();
	const boards = new FakeBoards(clock);
	const records = new MemoryRecords();
	const blobs = new MemoryBlobs();
	const config: CommuteConfig = { ...commuteConfig({}), ...overrides };
	const core = () =>
		new RunnerCore({
			blobs,
			boards,
			clock: () => clock.now,
			config,
			log: (line) => logs.push(line),
			plans: db,
			push,
			records,
			secrets: {
				apnsKeyId: "KEYID12345",
				apnsP8: p8Pem,
				apnsTeamId: "TEAMID1234",
				apnsTopic: "com.cmu02.betro",
				fcmServiceAccountJson: FAKE_SERVICE_ACCOUNT,
			},
			sleep: () => Promise.resolve(),
			store,
			timetable: emptyTimetable,
			timezones: [DEFAULT_TIMEZONE],
			tokens: db,
		});
	return {
		blobs,
		boards,
		clock,
		config,
		core,
		db,
		logs,
		push,
		records,
		store,
	};
}

type Harness = ReturnType<typeof harness>;

function addIos(
	h: Harness,
	options: {
		env?: PushTokenRow["env"];
		installId?: string;
		planId?: string;
		token?: string;
	} = {}
): void {
	const installId = options.installId ?? IOS_INSTALL;
	h.db.addPlan(installId, makePlan(options.planId ?? PLAN_IOS));
	h.db.addToken(installId, "apns-start", options.token ?? START_TOKEN, {
		env: options.env ?? "sandbox",
	});
}

function addAndroid(
	h: Harness,
	options: {
		includeHolidays?: boolean;
		installId?: string;
		planId?: string;
		token?: string;
	} = {}
): void {
	const installId = options.installId ?? ANDROID_INSTALL;
	h.db.addPlan(
		installId,
		makePlan(options.planId ?? PLAN_ANDROID, {
			includeHolidays: options.includeHolidays,
		})
	);
	h.db.addToken(installId, "fcm", options.token ?? FCM_TOKEN, {
		env: "production",
	});
}

async function tickAt(h: Harness, core: RunnerCore, at: number) {
	h.clock.now = at;
	return await core.tick();
}

const TICK_STEP = 30 * SECOND;

/** `from`부터 `to`까지(포함) 30초마다 tick. */
async function tickRange(
	h: Harness,
	core: RunnerCore,
	from: number,
	to: number
): Promise<void> {
	if (from > to) {
		return;
	}
	await tickAt(h, core, from);
	await tickRange(h, core, from + TICK_STEP, to);
}

async function sessions(h: Harness): Promise<[string, SessionEntry][]> {
	const listed = await h.store.list<SessionEntry>("session:");
	return [...listed].map(([key, entry]) => [
		key.slice("session:".length),
		entry,
	]);
}

async function onlySession(h: Harness): Promise<[string, SessionEntry]> {
	const all = await sessions(h);
	expect(all).toHaveLength(1);
	return all[0] as [string, SessionEntry];
}

interface Aps {
	attributes?: unknown;
	"content-state"?: ContentState;
	event?: string;
}

function apsOf(sent: SentRequest): Aps {
	return (sent.body.aps ?? {}) as Aps;
}

function fcmDataOf(sent: SentRequest): Record<string, string> {
	const message = sent.body.message as
		| { data?: Record<string, string> }
		| undefined;
	return message?.data ?? {};
}

/** `apns:start`, `fcm:update`처럼. */
function describeSent(sent: SentRequest): string {
	if (sent.body.aps) {
		return `apns:${apsOf(sent).event}`;
	}
	return `fcm:${fcmDataOf(sent).event}`;
}

function contentOf(sent: SentRequest): ContentState {
	if (sent.body.aps) {
		return apsOf(sent)["content-state"] as ContentState;
	}
	const { state } = fcmDataOf(sent) as { state?: string };
	return JSON.parse(state ?? "null") as ContentState;
}

// ---------------------------------------------------------------------------

describe("RunnerCore 시작", () => {
	test("예약 시각이 되면 세션이 하나 생기고 시작 요청이 한 번 나간다(iOS APNs, Android FCM)", async () => {
		const h = harness();
		addIos(h);
		addAndroid(h);
		const core = h.core();

		const idle = await tickAt(h, core, T0 - 30 * SECOND);
		expect(h.db.sessions.size).toBe(0);
		expect(h.push.sent).toHaveLength(0);
		// 세션이 없으면 다음 분 경계에 깨어난다.
		expect(idle.nextAlarmAt).toBe(T0);

		const started = await tickAt(h, core, T0);
		expect(started.nextAlarmAt).toBe(T0 + h.config.tickMs);
		expect(h.db.sessions.size).toBe(2);
		expect(await sessions(h)).toHaveLength(2);
		expect(h.push.sent.map(describeSent).sort()).toEqual([
			"apns:start",
			"fcm:start",
		]);

		const apns = h.push.sent.find((s) => s.body.aps) as SentRequest;
		const iosSession = [...h.db.sessions.values()].find(
			(s) => s.planId === PLAN_IOS
		) as SessionRow;
		expect(iosSession.serviceDate).toBe(SERVICE_DATE);
		expect(apns.headers["apns-push-type"]).toBe("liveactivity");
		expect(apns.url).toContain(START_TOKEN);
		expect(apsOf(apns).attributes).toEqual({
			planId: PLAN_IOS,
			sessionId: iosSession.id,
		});
		expect(contentOf(apns).seq).toBe(1);

		const fcm = h.push.sent.find((s) => s.body.message) as SentRequest;
		expect(fcmDataOf(fcm).event).toBe("start");
		expect((fcm.body.message as { token: string }).token).toBe(FCM_TOKEN);
	});

	test("같은 분에 두 번 돌아도, 같은 저장소로 새로 만들어도 세션과 시작 요청은 하나다. seq가 이어지고 JWT는 다시 쓴다", async () => {
		const sign = spyOn(crypto.subtle, "sign");
		try {
			const h = harness();
			addIos(h);
			const first = h.core();
			await tickAt(h, first, T0);
			await tickAt(h, first, T0 + 10 * SECOND);
			const second = h.core();
			await tickAt(h, second, T0 + 20 * SECOND);

			expect(h.db.sessions.size).toBe(1);
			expect(await sessions(h)).toHaveLength(1);
			expect(h.push.sent.map(describeSent)).toEqual(["apns:start"]);

			const [sessionId] = await onlySession(h);
			h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, {
				sessionId,
			});
			await tickAt(h, second, T0 + 2 * MINUTE);

			expect(h.push.sent.map(describeSent)).toEqual([
				"apns:start",
				"apns:update",
			]);
			const [start, update] = h.push.sent as [SentRequest, SentRequest];
			expect(update.url).toContain(ACTIVITY_TOKEN);
			expect(contentOf(update).seq).toBe(2);
			expect(update.headers.authorization).toBe(start.headers.authorization);
			expect(sign).toHaveBeenCalledTimes(1);
		} finally {
			sign.mockRestore();
		}
	});

	test("나가는 날이 공휴일이면 세션이 없고, includeHolidays면 있다", async () => {
		const skipped = harness();
		skipped.db.holidays.add(SERVICE_DATE);
		addAndroid(skipped);
		await tickAt(skipped, skipped.core(), T0);
		expect(skipped.db.sessions.size).toBe(0);
		expect(skipped.push.sent).toHaveLength(0);

		const kept = harness();
		kept.db.holidays.add(SERVICE_DATE);
		addAndroid(kept, { includeHolidays: true });
		await tickAt(kept, kept.core(), T0);
		expect(kept.db.sessions.size).toBe(1);
		expect(kept.push.sent.map(describeSent)).toEqual(["fcm:start"]);
	});

	test("sandbox 토큰은 sandbox 호스트로, production 토큰은 운영 호스트로 간다", async () => {
		const h = harness();
		addIos(h, { env: "sandbox" });
		addIos(h, {
			env: "production",
			installId: IOS_INSTALL_2,
			planId: PLAN_IOS_2,
			token: START_TOKEN_2,
		});
		await tickAt(h, h.core(), T0);
		const hosts = new Map(
			h.push.sent.map((s) => {
				const url = new URL(s.url);
				return [url.pathname.split("/").at(-1), url.host];
			})
		);
		expect(hosts.get(START_TOKEN)).toBe("api.sandbox.push.apple.com");
		expect(hosts.get(START_TOKEN_2)).toBe("api.push.apple.com");
	});

	test("push-to-start 토큰이 없는 기기는 시작 요청 없이 no-token으로 닫고 다음 tick에도 보내지 않는다", async () => {
		const h = harness();
		h.db.addPlan(IOS_INSTALL, makePlan(PLAN_IOS));
		const core = h.core();
		await tickAt(h, core, T0);
		expect(h.push.sent).toEqual([]);
		const [row] = [...h.db.sessions.values()];
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("no-token");
		expect(await sessions(h)).toHaveLength(0);

		await tickAt(h, core, T0 + 30 * SECOND);
		expect(h.push.sent).toEqual([]);
		expect(h.db.sessions.size).toBe(1);
	});

	test("openSession 전에 토큰 조회가 실패해도 다음 tick에 세션이 열린다", async () => {
		const h = harness();
		addAndroid(h);
		const lookup = h.db.tokens.bind(h.db);
		let failed = false;
		h.db.tokens = (installId) => {
			if (!failed) {
				failed = true;
				return Promise.reject(new Error("D1 unavailable"));
			}
			return lookup(installId);
		};
		const core = h.core();
		await tickAt(h, core, T0);
		expect(h.push.sent).toEqual([]);

		await tickAt(h, core, T0 + 30 * SECOND);
		expect(h.push.sent.map(describeSent)).toEqual(["fcm:start"]);
		expect(await sessions(h)).toHaveLength(1);
		const [row] = [...h.db.sessions.values()];
		expect(h.db.sessions.size).toBe(1);
		expect(row?.status).toBe("active");
	});

	test("openSession 뒤 저장소 쓰기가 실패하면 D1 세션 행을 닫는다", async () => {
		const h = harness();
		addAndroid(h);
		const put = h.store.put.bind(h.store);
		let failed = false;
		h.store.put = (key, value) => {
			if (!failed && key.startsWith("session:")) {
				failed = true;
				return Promise.reject(new Error("storage unavailable"));
			}
			return put(key, value);
		};
		await tickAt(h, h.core(), T0);
		expect(h.push.sent).toEqual([]);
		expect(await sessions(h)).toHaveLength(0);
		const [row] = [...h.db.sessions.values()];
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("no-token");
	});
});

describe("RunnerCore iOS 업데이트 토큰", () => {
	test("업데이트 토큰이 오기 전에는 갱신을 보내지 않고, 오면 다음 tick에 보낸다", async () => {
		// 30초마다 버스를 불러 30초 뒤 값이 바뀌게 한다.
		const h = harness({ busPollMs: 30 * SECOND });
		addIos(h);
		const core = h.core();
		await tickAt(h, core, T0);
		// 30초 뒤 V1이 한 정거장 다가와 값이 바뀌지만 토큰이 없다.
		await tickAt(h, core, T0 + 30 * SECOND);
		expect(h.push.sent.map(describeSent)).toEqual(["apns:start"]);

		const [sessionId] = await onlySession(h);
		h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, { sessionId });
		await tickAt(h, core, T0 + 50 * SECOND);
		expect(h.push.sent.map(describeSent)).toEqual([
			"apns:start",
			"apns:update",
		]);
		const [, entry] = await onlySession(h);
		expect(entry.updatable).toBe(true);
		expect(entry.tokenAt).toBe(T0);
	});

	test("60초가 지나도 토큰이 오지 않으면 updatable이 false이고 시작은 여전히 한 번이다", async () => {
		const h = harness();
		addIos(h);
		const core = h.core();
		await tickRange(h, core, T0, T0 + 3 * MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual(["apns:start"]);
		const [, entry] = await onlySession(h);
		expect(entry.tokenWaitUntil).toBe(T0 + h.config.tokenWaitMs);
		expect(entry.updatable).toBe(false);
	});
});

describe("RunnerCore 푸시 응답", () => {
	test("BadDeviceToken이면 그 토큰 행을 지운다", async () => {
		const h = harness();
		addIos(h);
		h.push.respond = () => ({ reason: "BadDeviceToken", status: 400 });
		await tickAt(h, h.core(), T0);
		expect(h.db.tokenRows.filter((r) => r.kind === "apns-start")).toEqual([]);
		const [row] = [...h.db.sessions.values()];
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("no-token");
		expect(await sessions(h)).toHaveLength(0);
	});

	const deadActivityReplies: PushResult[] = [
		{ reason: "Unregistered", status: 410 },
		{ reason: "BadDeviceToken", status: 400 },
	];
	for (const reply of deadActivityReplies) {
		test(`세션 도중 업데이트 토큰이 ${reply.status} ${reply.reason}이면 그 토큰만 지우고 세션은 갱신 불가로 열어 둔다`, async () => {
			const h = harness();
			addIos(h);
			const core = h.core();
			await tickAt(h, core, T0);
			const [sessionId] = await onlySession(h);
			h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, {
				sessionId,
			});
			h.push.respond = (sent) =>
				apsOf(sent).event === "update" ? reply : { reason: null, status: 200 };

			await tickAt(h, core, T0 + 60 * SECOND);
			await tickAt(h, core, T0 + 90 * SECOND);

			expect(
				h.db.tokenRows.filter((row) => row.kind === "apns-activity")
			).toEqual([]);
			expect(h.db.tokenRows.map((row) => row.kind)).toEqual(["apns-start"]);
			const [, entry] = await onlySession(h);
			expect(entry.updatable).toBe(false);
			expect(entry.state.stage).not.toBe("ended");
			const [sessionRow] = [...h.db.sessions.values()];
			expect(sessionRow?.status).toBe("active");
			expect(
				h.push.sent.map(describeSent).filter((name) => name === "apns:start")
			).toEqual(["apns:start"]);
			expect(h.push.sent.map(describeSent)).toEqual([
				"apns:start",
				"apns:update",
			]);
		});
	}

	test("FCM UNREGISTERED면 그 설치의 토큰·경로·설치 행을 모두 지운다", async () => {
		const h = harness();
		addAndroid(h);
		addAndroid(h, {
			installId: ANDROID_INSTALL_2,
			planId: PLAN_ANDROID_2,
			token: FCM_TOKEN_2,
		});
		h.push.respond = (sent) =>
			(sent.body.message as { token: string }).token === FCM_TOKEN
				? { reason: "UNREGISTERED", status: 404 }
				: { reason: null, status: 200 };
		await tickAt(h, h.core(), T0);
		expect(h.db.tokenRows.map((r) => r.installId)).toEqual([ANDROID_INSTALL_2]);
		expect([...h.db.plans.keys()]).toEqual([PLAN_ANDROID_2]);
		expect(h.db.installs.has(ANDROID_INSTALL)).toBe(false);
		expect(h.db.installs.has(ANDROID_INSTALL_2)).toBe(true);
		expect(await sessions(h)).toHaveLength(1);
	});

	test("FCM 400 INVALID_ARGUMENT면 그 토큰 행만 지우고 설치와 경로가 남는다", async () => {
		const h = harness();
		addAndroid(h);
		h.push.respond = () => ({ reason: "INVALID_ARGUMENT", status: 400 });
		await tickAt(h, h.core(), T0);
		expect(h.push.sent.map(describeSent)).toEqual(["fcm:start"]);
		expect(h.db.tokenRows).toEqual([]);
		expect([...h.db.plans.keys()]).toEqual([PLAN_ANDROID]);
		expect(h.db.installs.has(ANDROID_INSTALL)).toBe(true);
		const [row] = [...h.db.sessions.values()];
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("no-token");
		expect(await sessions(h)).toHaveLength(0);
	});

	test("세션 도중 경로를 지우면 다음 tick에 종료 요청이 나가고 plan-removed로 닫는다", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		h.db.plans.delete(PLAN_ANDROID);
		await tickAt(h, core, T0 + 30 * SECOND);
		expect(h.push.sent.map(describeSent)).toEqual(["fcm:start", "fcm:end"]);
		const end = h.push.sent.at(-1) as SentRequest;
		expect(contentOf(end).stage).toBe("ended");
		expect(contentOf(end).seq).toBe(2);
		const [row] = [...h.db.sessions.values()];
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("plan-removed");
		expect(await sessions(h)).toHaveLength(0);
	});

	test("ExpiredProviderToken이면 JWT를 새로 만들어 같은 tick에 한 번 다시 보낸다", async () => {
		const sign = spyOn(crypto.subtle, "sign");
		try {
			const h = harness();
			addIos(h);
			const core = h.core();
			await tickAt(h, core, T0);
			const [sessionId] = await onlySession(h);
			h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, {
				sessionId,
			});
			let rejected = false;
			h.push.respond = (sent) => {
				if (apsOf(sent).event === "update" && !rejected) {
					rejected = true;
					return { reason: "ExpiredProviderToken", status: 403 };
				}
				return { reason: null, status: 200 };
			};
			await tickAt(h, core, T0 + 60 * SECOND);
			expect(h.push.sent.map(describeSent)).toEqual([
				"apns:start",
				"apns:update",
				"apns:update",
			]);
			expect(sign).toHaveBeenCalledTimes(2);
			const [, entry] = await onlySession(h);
			expect(entry.lastContent?.seq).toBe(2);
			const cached = await h.store.get<{ issuedAt: number; token: string }>(
				"apnsJwt"
			);
			expect(h.push.sent.at(-1)?.headers.authorization).toBe(
				`bearer ${cached?.token}`
			);
		} finally {
			sign.mockRestore();
		}
	});
});

describe("RunnerCore 도착판", () => {
	test("도착판이 멈추면 151초 뒤 보낸 값이 estimated·stale이고, 값이 그대로여도 120초 안에 한 번은 보낸다", async () => {
		const h = harness();
		addAndroid(h);
		h.boards.frozenAt = T0;
		const core = h.core();
		await tickRange(h, core, T0, T0 + 150 * SECOND);
		const live = contentOf(h.push.sent.at(-1) as SentRequest);
		expect(live.positionState).toBe("live");
		expect(live.etaState).toBe("live");

		const before = h.push.sent.length;
		await tickAt(h, core, T0 + 151 * SECOND);
		expect(h.push.sent.length).toBe(before + 1);
		const stale = contentOf(h.push.sent.at(-1) as SentRequest);
		expect(stale.positionState).toBe("stale");
		expect(stale.etaState).toBe("estimated");

		await tickRange(h, core, T0 + 180 * SECOND, T0 + 10 * MINUTE);
		const sentAts = h.push.sent.map((s) => contentOf(s).sentAt);
		for (let i = 1; i < sentAts.length; i += 1) {
			expect(
				(sentAts[i] as number) - (sentAts[i - 1] as number)
			).toBeLessThanOrEqual(120);
		}
	});

	test("버스는 탈 차량이 10분 뒤면 60초, 5분 뒤면 30초마다 부른다", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickRange(h, core, T0, T0 + 5 * MINUTE);
		expect(h.boards.busCalls).toHaveLength(6);

		await tickRange(h, core, T0 + 5.5 * MINUTE, T0 + 10.5 * MINUTE);
		const before = h.boards.busCalls.length;
		// 08:06:00 ~ 08:08:00: V1(08:11:24)이 6분 안이다.
		await tickRange(h, core, T0 + 11 * MINUTE, T0 + 13 * MINUTE);
		expect(h.boards.busCalls.length - before).toBe(5);
	});

	test("같은 노선을 보는 세션이 둘이어도 호출은 한 번이다", async () => {
		const h = harness();
		addAndroid(h);
		addAndroid(h, {
			installId: ANDROID_INSTALL_2,
			planId: PLAN_ANDROID_2,
			token: FCM_TOKEN_2,
		});
		await tickAt(h, h.core(), T0);
		expect(await sessions(h)).toHaveLength(2);
		expect(h.boards.busCalls).toEqual([ROUTE_ID]);
	});

	test("하루 예산을 다 쓰면 부르지 않고 배차간격 추정으로 간다", async () => {
		const h = harness({ dailyBudgetBusArrival: 2 });
		addAndroid(h);
		const core = h.core();
		await tickRange(h, core, T0, T0 + 6 * MINUTE);
		expect(h.boards.busCalls).toHaveLength(2);
		expect(await h.store.get<number>(`budget:${SERVICE_DATE}`)).toBe(2);
		const [, entry] = await onlySession(h);
		const leg = entry.state.estimates[0]?.legs[0];
		expect(leg?.method).toBe("headway");
		expect(leg?.positionState).toBe("stale");
	});

	test("상류가 401이면 그날 버스 호출을 멈추고 세션은 추정으로 계속 간다", async () => {
		const h = harness();
		addAndroid(h);
		h.boards.handler = () => new UpstreamStoppedError("auth");
		const core = h.core();
		await tickRange(h, core, T0, T0 + 5 * MINUTE);
		expect(h.boards.busCalls).toHaveLength(1);
		expect(await h.store.get(`stopped:${SERVICE_DATE}`)).toBeDefined();
		const [, entry] = await onlySession(h);
		expect(entry.state.stage).toBe("walk");
		expect(entry.state.estimates[0]?.legs[0]?.method).toBe("headway");
		expect(h.push.sent.length).toBeGreaterThan(1);
	});

	test("지하철 역 행은 빈 응답이면 돌리지 않고, 앞 폴링이 묵었으면 prev로 쓰지 않는다", async () => {
		const h = harness();
		h.db.addPlan(ANDROID_INSTALL, makeSubwayPlan(PLAN_ANDROID));
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		const core = h.core();
		const row = (trainNo: string, sourceAt: number): StationRow => ({
			arvlCd: "5",
			barvlSec: 90,
			direction: "down",
			ordkey: "01001역삼0",
			sourceAt,
			trainNo,
		});
		const savedOf = () =>
			h.store.get<{
				cur: { fetchedAt: number; rows: StationRow[] };
				prev: { fetchedAt: number; rows: StationRow[] } | null;
			}>(`station:${GANGNAM}`);
		const first = { fetchedAt: T0 - 5 * SECOND, rows: [row("T1", T0)] };
		h.boards.stationRows[GANGNAM] = first;
		await tickAt(h, core, T0);
		expect(h.boards.watched.at(-1)).toContain(GANGNAM);
		expect(await savedOf()).toEqual({ cur: first, prev: null });

		h.boards.stationRows[GANGNAM] = { fetchedAt: T0 + 25 * SECOND, rows: [] };
		await tickAt(h, core, T0 + 30 * SECOND);
		expect(await savedOf()).toEqual({ cur: first, prev: null });

		const second = {
			fetchedAt: T0 + 55 * SECOND,
			rows: [row("T2", T0 + 55 * SECOND)],
		};
		h.boards.stationRows[GANGNAM] = second;
		await tickAt(h, core, T0 + 60 * SECOND);
		expect(await savedOf()).toEqual({ cur: second, prev: first });

		const late = {
			fetchedAt: second.fetchedAt + h.config.staleAfterMs + SECOND,
			rows: [row("T3", second.fetchedAt + h.config.staleAfterMs)],
		};
		h.boards.stationRows[GANGNAM] = late;
		await tickAt(h, core, late.fetchedAt + 5 * SECOND);
		expect(await savedOf()).toEqual({ cur: late, prev: null });
	});

	test("상류가 응답하지 못하면 1초, 2초 뒤 두 번까지 다시 부르고 시도마다 예산을 쓴다", async () => {
		const h = harness();
		addAndroid(h);
		h.boards.handler = () => null;
		await tickAt(h, h.core(), T0);
		expect(h.boards.busCalls).toHaveLength(3);
		expect(await h.store.get<number>(`budget:${SERVICE_DATE}`)).toBe(3);
	});
});

describe("RunnerCore 입력과 종료", () => {
	test("다른 설치는 not-found, end는 종료 요청과 closeSession(user), 끝난 세션은 ended", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);

		expect(
			await core.input(OTHER_INSTALL, sessionId, { kind: "boarded" })
		).toBe("not-found");
		expect(
			await core.input(ANDROID_INSTALL, "no-such-session", { kind: "next" })
		).toBe("not-found");

		h.clock.now = T0 + 10 * SECOND;
		expect(await core.input(ANDROID_INSTALL, sessionId, { kind: "end" })).toBe(
			"ok"
		);
		expect(h.push.sent.map(describeSent)).toEqual(["fcm:start", "fcm:end"]);
		const row = h.db.sessions.get(sessionId);
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("user");

		expect(
			await core.input(ANDROID_INSTALL, sessionId, { kind: "boarded" })
		).toBe("ended");
		expect(await core.input(OTHER_INSTALL, sessionId, { kind: "end" })).toBe(
			"not-found"
		);
	});

	test("세션이 끝나면 그 세션의 저장소 키와 apns-activity 토큰이 없다", async () => {
		const h = harness();
		addIos(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, { sessionId });

		h.clock.now = T0 + 20 * SECOND;
		expect(await core.input(IOS_INSTALL, sessionId, { kind: "end" })).toBe(
			"ok"
		);
		const end = h.push.sent.at(-1) as SentRequest;
		expect(describeSent(end)).toBe("apns:end");
		expect(end.url).toContain(ACTIVITY_TOKEN);
		expect(await h.store.get(`session:${sessionId}`)).toBeUndefined();
		// 끝난 세션의 입력에 409를 주려고 설치 ID와 종료 시각만 하루 동안 남긴다.
		expect(
			[...h.store.data.keys()].filter((key) => key.includes(sessionId))
		).toEqual([`ended:${sessionId}`]);
		expect(h.db.tokenRows.map((r) => r.kind)).toEqual(["apns-start"]);
		const after = await tickAt(h, core, T0 + 30 * SECOND);
		expect(after.nextAlarmAt).toBe(T0 + MINUTE);
	});

	test("activeSession과 ack", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);

		const active = await core.activeSession(ANDROID_INSTALL);
		expect(active?.sessionId).toBe(sessionId);
		expect(active?.planId).toBe(PLAN_ANDROID);
		expect(active?.content.seq).toBe(1);
		expect(await core.activeSession(OTHER_INSTALL)).toBeNull();

		expect(await core.ack(OTHER_INSTALL, sessionId, T0 + 5 * SECOND)).toBe(
			"not-found"
		);
		expect(await core.ack(ANDROID_INSTALL, sessionId, T0 + 5 * SECOND)).toBe(
			"ok"
		);
		expect(await core.ack(ANDROID_INSTALL, sessionId, T0 + 9 * SECOND)).toBe(
			"ok"
		);
		const [, entry] = await onlySession(h);
		expect(entry.shownAt).toBe(T0 + 5 * SECOND);
		expect(entry.dueAt).toBe(T0);
	});
});

describe("RunnerCore 로그", () => {
	test("포트가 키·토큰이 든 오류를 던져도 로그에 API 키, p8, 설치 비밀값, 토큰 전체가 없다", async () => {
		const h = harness();
		addIos(h);
		addAndroid(h);
		h.boards.handler = () =>
			new Error(
				`GET http://ws.bus.go.kr/api/rest/arrive/getArrInfoByRouteAll?serviceKey=${API_KEY}&busRouteId=${ROUTE_ID} failed`
			);
		h.push.respond = (sent) => {
			if (sent.body.aps) {
				return new Error(`apns failed for ${START_TOKEN} with ${p8Pem}`);
			}
			return new Error(`fcm failed ${FCM_TOKEN} ${FAKE_SERVICE_ACCOUNT}`);
		};
		await tickRange(h, h.core(), T0, T0 + 2 * MINUTE);

		expect(h.logs.some((line) => line.includes("failed"))).toBe(true);
		const forbidden = [
			API_KEY,
			p8Body,
			INSTALL_SECRET,
			START_TOKEN,
			FCM_TOKEN,
			SA_PRIVATE_LINE,
		];
		for (const line of h.logs) {
			for (const secret of forbidden) {
				expect(line).not.toContain(secret);
			}
		}
	});

	test("PUSH_MODE=log용 PushSender는 요청을 보내지 않고 200을 돌려준다", async () => {
		const fetchSpy = spyOn(globalThis, "fetch");
		try {
			const lines: string[] = [];
			const sender = logPushSender((line) => lines.push(line));
			const result = await sender.send(
				new Request(
					`https://api.sandbox.push.apple.com/3/device/${START_TOKEN}`,
					{
						body: JSON.stringify({ aps: { event: "start" } }),
						method: "POST",
					}
				)
			);
			expect(result).toEqual({ reason: null, status: 200 });
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(lines.some((line) => line.includes("push (log) start"))).toBe(
				true
			);
			for (const line of lines) {
				expect(line).not.toContain(START_TOKEN);
			}
			const access = await sender.fcmAccessToken(T0);
			expect(access.expiresAt).toBeGreaterThan(T0);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// 정확도 기록(Task 11)

function recordsKey(sessionId: string): string {
	return `commute/records/${SERVICE_DATE}/${sessionId}.ndjson.gz`;
}

function summaryKey(sessionId: string): string {
	return `commute/summaries/${SERVICE_DATE}/${sessionId}.json`;
}

function ndjsonOf(h: Harness, sessionId: string): string {
	const found = h.blobs.objects.get(recordsKey(sessionId));
	if (!found) {
		throw new Error("records object missing");
	}
	expect(found.type).toBe("application/gzip");
	return new TextDecoder().decode(gunzipSync(found.body));
}

async function summaryOf(
	h: Harness,
	sessionId: string
): Promise<SessionSummary | null> {
	const text = await h.blobs.get(summaryKey(sessionId));
	return text === null ? null : (JSON.parse(text) as SessionSummary);
}

/** 기본 경로(6411)에 대안 하나(150, 도보 1분씩). 대안의 A1이 6분 넘게 빠르다. */
function makeSuggestPlan(planId: string): CommutePlan {
	const plan = makePlan(planId);
	plan.routes.push({
		legs: [
			{
				alight: {
					name: "흑석동",
					seq: ALIGHT_SEQ,
					stop: "seoul-bus:119000940",
				},
				board: {
					name: "노량진수산시장",
					seq: BOARD_SEQ,
					stop: "seoul-bus:119000930",
				},
				line: `seoul-bus:${ALT_ROUTE_ID}`,
				lineName: "150",
				mode: "bus",
			},
		],
		rank: 1,
		walkMinutes: [1, 1],
	});
	return plan;
}

describe("RunnerCore 정확도 기록", () => {
	test("세션이 끝나면 R2에 기록과 요약이 생기고 기록 표가 빈다. 실행기를 새로 만들어도 그 전 tick의 기록이 들어 있다", async () => {
		const h = harness();
		addAndroid(h);
		const first = h.core();
		await tickAt(h, first, T0);
		const [sessionId] = await onlySession(h);
		expect(await first.ack(ANDROID_INSTALL, sessionId, T0 + 5 * SECOND)).toBe(
			"ok"
		);
		await tickAt(h, first, T0 + 30 * SECOND);
		expect(h.blobs.puts).toEqual([]);

		const second = h.core();
		await tickAt(h, second, T0 + 60 * SECOND);
		h.clock.now = T0 + 70 * SECOND;
		expect(
			await second.input(ANDROID_INSTALL, sessionId, { kind: "end" })
		).toBe("ok");

		expect(h.blobs.puts.sort()).toEqual(
			[recordsKey(sessionId), summaryKey(sessionId)].sort()
		);
		expect(h.records.rows.get(sessionId) ?? []).toEqual([]);

		const text = ndjsonOf(h, sessionId);
		const records = text
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as AccuracyRecord);
		const predictionAts = records
			.filter((record) => record.kind === "prediction")
			.map((record) => record.at);
		// 처음 실행기가 남긴 tick(T0, T0+30초)도 들어 있다.
		expect(predictionAts).toEqual([T0, T0 + 30 * SECOND, T0 + 60 * SECOND]);
		const kinds = new Set(records.map((record) => record.kind));
		for (const kind of ["start", "send", "input", "end"]) {
			expect(kinds.has(kind as AccuracyRecord["kind"])).toBe(true);
		}
		const prediction = records.find((record) => record.kind === "prediction");
		expect(prediction).toMatchObject({
			line: `seoul-bus:${ROUTE_ID}`,
			method: "official",
			sessionId,
			stop: "seoul-bus:119000030",
			vehicleId: "V1",
		});

		const summary = await summaryOf(h, sessionId);
		expect(summary).toMatchObject({
			endReason: "user",
			planId: PLAN_ANDROID,
			sessionId,
			startDelayMs: 5 * SECOND,
		});

		const summaryText = (await h.blobs.get(summaryKey(sessionId))) ?? "";
		const forbidden = [
			ANDROID_INSTALL,
			FCM_TOKEN,
			API_KEY,
			INSTALL_SECRET,
			SA_PRIVATE_LINE,
			"access-",
		];
		for (const secret of forbidden) {
			expect(text).not.toContain(secret);
			expect(summaryText).not.toContain(secret);
		}
	});

	test("토큰이 없어 바로 닫은 세션도 요약을 남긴다", async () => {
		const h = harness();
		h.db.addPlan(IOS_INSTALL, makePlan(PLAN_IOS));
		await tickAt(h, h.core(), T0);
		const [row] = [...h.db.sessions.values()];
		const summary = await summaryOf(h, row?.id ?? "");
		expect(summary).toMatchObject({
			endReason: "no-token",
			planId: PLAN_IOS,
			startDelayMs: null,
		});
	});

	test("제안이 나간 세션은 끝난 뒤에도 두 차량이 하차 정류장에 닿을 때까지 도착판만 보고 판정을 남긴다", async () => {
		const h = harness();
		h.db.addPlan(ANDROID_INSTALL, makeSuggestPlan(PLAN_ANDROID));
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		/** A1은 08:07에 대안 승차 정류장, 08:17에 하차 정류장에 닿는다. */
		const altVehicles: SimVehicle[] = [
			{ arriveBoardAt: T0 + 12 * MINUTE, id: "A1" },
		];
		h.boards.handler = (routeId) =>
			routeStops(
				routeId === ALT_ROUTE_ID ? altVehicles : h.boards.vehicles,
				h.clock.now,
				h.clock.now
			);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		expect(contentOf(h.push.sent[0] as SentRequest).suggestion?.rank).toBe(1);

		h.clock.now = T0 + 30 * SECOND;
		expect(await core.input(ANDROID_INSTALL, sessionId, { kind: "end" })).toBe(
			"ok"
		);
		expect(h.push.sent.map(describeSent)).toEqual(["fcm:start", "fcm:end"]);
		// 두 차량이 아직 하차 정류장에 닿지 않아 요약을 미룬다.
		expect(await summaryOf(h, sessionId)).toBeNull();
		const following = await tickAt(h, core, T0 + 60 * SECOND);
		expect(following.nextAlarmAt).toBe(T0 + 60 * SECOND + h.config.tickMs);

		await tickRange(h, core, T0 + 90 * SECOND, T0 + 28 * MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual(["fcm:start", "fcm:end"]);
		const summary = await summaryOf(h, sessionId);
		// V1: 08:21~08:22 사이 하차(가운데 08:21:30) + 3분, A1: 08:16~08:17(08:16:30) + 1분.
		expect(summary?.suggestions).toEqual([
			{ gainMs: 7 * MINUTE, verdict: "faster" },
		]);
		expect(await h.store.get(`follow:${sessionId}`)).toBeUndefined();
		expect(h.records.rows.get(sessionId) ?? []).toEqual([]);
		const idle = await tickAt(h, core, T0 + 28 * MINUTE + 30 * SECOND);
		expect(idle.nextAlarmAt).toBe(T0 + 29 * MINUTE);
	});

	test("제안을 따라가던 차량이 30분 안에 닿지 않으면 그때 판정 없이 요약을 쓴다", async () => {
		const h = harness();
		h.db.addPlan(ANDROID_INSTALL, makeSuggestPlan(PLAN_ANDROID));
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		const altVehicles: SimVehicle[] = [
			{ arriveBoardAt: T0 + 12 * MINUTE, id: "A1" },
		];
		h.boards.handler = (routeId) =>
			routeStops(
				routeId === ALT_ROUTE_ID ? altVehicles : h.boards.vehicles,
				h.clock.now,
				h.clock.now
			);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		h.clock.now = T0 + 30 * SECOND;
		await core.input(ANDROID_INSTALL, sessionId, { kind: "end" });
		// 도착판이 그 뒤로 비어 차량을 다시 보지 못한다.
		h.boards.handler = () => [];
		await tickAt(h, core, T0 + 29 * MINUTE);
		expect(await summaryOf(h, sessionId)).toBeNull();
		await tickAt(h, core, T0 + 30 * MINUTE + 30 * SECOND);
		const summary = await summaryOf(h, sessionId);
		expect(summary?.suggestions).toEqual([
			{ gainMs: null, verdict: "unknown" },
		]);
		expect(await h.store.get(`follow:${sessionId}`)).toBeUndefined();
	});

	test("writeDailyReport는 그날 요약을 모아 쓰고, 같은 날짜로 두 번 불러도 R2 쓰기는 한 번이다", async () => {
		const h = harness();
		const stored: SessionSummary = {
			endReason: "arrived",
			maxSendGapMs: 60_000,
			planId: PLAN_ANDROID,
			predictions: [],
			sessionId: "s1",
			startDelayMs: 8000,
			suggestions: [],
		};
		await h.blobs.put(
			`commute/summaries/${SERVICE_DATE}/s1.json`,
			new TextEncoder().encode(JSON.stringify(stored)),
			"application/json"
		);
		await h.blobs.put(
			"commute/summaries/2026-11-11/s2.json",
			new TextEncoder().encode(JSON.stringify({ ...stored, sessionId: "s2" })),
			"application/json"
		);
		const core = h.core();
		expect(await core.writeDailyReport(SERVICE_DATE)).toBe(true);
		expect(await core.writeDailyReport(SERVICE_DATE)).toBe(false);
		expect(await h.core().writeDailyReport(SERVICE_DATE)).toBe(false);
		const reportKey = `commute/reports/${SERVICE_DATE}.json`;
		expect(h.blobs.puts.filter((key) => key === reportKey)).toHaveLength(1);
		const report = JSON.parse((await h.blobs.get(reportKey)) ?? "null") as {
			date: string;
			sessions: number;
			starts: { onTime: number };
		};
		expect(report.date).toBe(SERVICE_DATE);
		expect(report.sessions).toBe(1);
		expect(report.starts.onTime).toBe(1);
	});

	test("commuteReportDate는 다음 날 04:00부터 그 전날을 가리킨다", () => {
		// 2026-11-11 04:00 KST
		const fourAm = Date.UTC(2026, 10, 10, 19, 0);
		expect(commuteReportDate(fourAm, DEFAULT_TIMEZONE)).toBe(SERVICE_DATE);
		expect(commuteReportDate(fourAm - MINUTE, DEFAULT_TIMEZONE)).toBe(
			"2026-11-09"
		);
	});
});

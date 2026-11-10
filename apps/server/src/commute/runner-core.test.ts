import {
	type CommuteConfig,
	commuteConfig,
	DEFAULT_TIMEZONE,
} from "@Betro/commute/config";
import type { CommutePlan } from "@Betro/commute/plan";
import type { ContentState } from "@Betro/commute/session/content";
import type { EndReason } from "@Betro/commute/session/stage";
import type { RouteStopArrival } from "@Betro/commute/sources/seoul-bus";
import type { TimetablePort } from "@Betro/commute/sources/seoul-subway";
import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { PushTokenRow } from "./auth";
import {
	type BoardSource,
	logPushSender,
	type PlanStore,
	type PushResult,
	type PushSender,
	type RunnerStore,
	type TokenStore,
	UpstreamStoppedError,
} from "./ports";
import { startMinuteOf } from "./routes";
import { RunnerCore, type SessionEntry } from "./runner-core";

const SECOND = 1000;
const MINUTE = 60_000;
/** 07:55 KST, 2026-11-10(화). 나가는 시각 08:05의 10분 전이다. */
const T0 = Date.UTC(2026, 10, 9, 22, 55);
const SERVICE_DATE = "2026-11-10";
const ROUTE_ID = "100100290";
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

	stations(): Promise<Record<string, never>> {
		return Promise.resolve({});
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
	const config: CommuteConfig = { ...commuteConfig({}), ...overrides };
	const core = () =>
		new RunnerCore({
			boards,
			clock: () => clock.now,
			config,
			log: (line) => logs.push(line),
			plans: db,
			push,
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
	return { boards, clock, config, core, db, logs, push, store };
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

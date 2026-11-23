import type { AccuracyRecord, SessionSummary } from "@Betro/commute/accuracy";
import {
	type CommuteConfig,
	commuteConfig,
	DEFAULT_TIMEZONE,
} from "@Betro/commute/config";
import type { BusLeg, CommutePlan, Route } from "@Betro/commute/plan";
import type { ContentState } from "@Betro/commute/session/content";
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
	type RegionalRouteRef,
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

/**
 * 경기(GBIS) 노선 한 구간. 노선 ID를 서울 6411과 같게 두어, 출처를 보지 않고 ID만 쓰면
 * 서울 도착 정보를 부르게 된다.
 */
function regionalLeg(): BusLeg {
	return {
		alight: { name: "다", seq: ALIGHT_SEQ, stop: "gbis:228000174" },
		board: { name: "라", seq: BOARD_SEQ, stop: "gbis:228000160" },
		line: `gbis:${ROUTE_ID}`,
		lineName: "11",
		mode: "bus",
	};
}

function makeRegionalPlan(planId: string): CommutePlan {
	const plan = makePlan(planId);
	plan.routes = [{ legs: [regionalLeg()], rank: 0, walkMinutes: [5, 3] }];
	return plan;
}

const TAGO_ROUTE_ID = "ICB361000005";
const TAGO_LINE = `tago:${TAGO_ROUTE_ID}`;
const TAGO_CITY = "23";

/** 인천(TAGO) 노선 한 구간. */
function tagoLeg(): BusLeg {
	return {
		alight: { name: "바", seq: ALIGHT_SEQ, stop: "tago:ICB365000192" },
		board: { name: "마", seq: BOARD_SEQ, stop: "tago:ICB364000528" },
		line: TAGO_LINE,
		lineName: "82",
		mode: "bus",
	};
}

function makeTagoPlan(planId: string): CommutePlan {
	const plan = makePlan(planId);
	plan.routes = [{ legs: [tagoLeg()], rank: 0, walkMinutes: [5, 3] }];
	return plan;
}

/** 배차간격 10분, 운행 시간 제한 없음. 요청한 노선 가운데 `lines`에만 준다. */
function tenMinuteHeadway(
	lines: string[]
): (ids: string[]) => Record<string, BusSchedule> {
	return (ids) =>
		Object.fromEntries(
			ids
				.filter((id) => lines.includes(id))
				.map((id) => [
					id,
					{ firstBusMinute: null, headwayMin: 10, lastBusMinute: null },
				])
		);
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

	/** 지역 도착 호출(시도마다). */
	readonly regionalCalls: {
		routeId: string;
		seq: number;
		source: RegionalSource;
	}[] = [];
	/** 지역 위치 목록 호출(시도마다). */
	readonly locationCalls: { routeId: string; source: RegionalSource }[] = [];
	/** 정하지 않으면 지역 호출은 응답이 없다(null). */
	regionalArrivalHandler:
		| ((
				route: RegionalRouteRef,
				stop: RegionalStop
		  ) => RouteStopArrival | null | Error)
		| null = null;
	regionalLocationsHandler:
		| ((route: RegionalRouteRef) => RegionalPosition[] | null | Error)
		| null = null;

	regionalArrival(
		route: RegionalRouteRef,
		stop: RegionalStop
	): Promise<RouteStopArrival | null> {
		this.regionalCalls.push({
			routeId: route.routeId,
			seq: stop.seq,
			source: route.source,
		});
		const handled = this.regionalArrivalHandler?.(route, stop) ?? null;
		return handled instanceof Error
			? Promise.reject(handled)
			: Promise.resolve(handled);
	}

	regionalLocations(
		route: RegionalRouteRef
	): Promise<RegionalPosition[] | null> {
		this.locationCalls.push({ routeId: route.routeId, source: route.source });
		const handled = this.regionalLocationsHandler?.(route) ?? null;
		return handled instanceof Error
			? Promise.reject(handled)
			: Promise.resolve(handled);
	}
}

/** 시뮬레이션 차량의 지금 순번(소수). */
function simPosition(vehicle: SimVehicle, at: number): number {
	return BOARD_SEQ - (vehicle.arriveBoardAt - at) / (SEC_PER_STOP * SECOND);
}

/**
 * 시뮬레이션 차량으로 지역 도착(정류장 하나, 가까운 두 대)과 위치 목록을 준다. GBIS·TAGO 응답처럼
 * 배차간격은 없고, TAGO 도착은 파서처럼 차량 ID를 비운다. `at`을 주면 차량이 그 시각에 멈춘다.
 */
function simulateRegional(h: Harness, at: (() => number) | null = null): void {
	const clockAt = () => at?.() ?? h.clock.now;
	h.boards.regionalArrivalHandler = (route, stop) => {
		const found = routeStops(h.boards.vehicles, clockAt(), h.clock.now).find(
			(entry) => entry.seq === stop.seq
		);
		if (!found) {
			return null;
		}
		return {
			...found,
			headwayMin: null,
			stopId: stop.stopId,
			vehicles: found.vehicles.map((vehicle) =>
				route.source === "tago"
					? { ...vehicle, plate: "", vehicleId: "" }
					: vehicle
			),
		};
	};
	h.boards.regionalLocationsHandler = () =>
		h.boards.vehicles
			.map((vehicle) => ({
				plate: `경기70아${vehicle.id}`,
				seq: Math.floor(simPosition(vehicle, clockAt())),
				vehicleId: vehicle.id,
			}))
			.filter((position) => position.seq >= 1 && position.seq <= LAST_SEQ);
}

const emptyTimetable: TimetablePort = {
	nextArrivals: () => Promise.resolve([]),
	rideMs: () => Promise.resolve(null),
};

/** 정적 버스 일정 포트. 기본은 일정이 없다. 부른 노선 목록을 남긴다. */
class FakeBusSchedules {
	readonly calls: string[][] = [];
	handler: (busRouteIds: string[]) => Record<string, BusSchedule> | Error =
		() => ({});

	read = (busRouteIds: string[]): Promise<Record<string, BusSchedule>> => {
		this.calls.push(busRouteIds);
		const result = this.handler(busRouteIds);
		return result instanceof Error
			? Promise.reject(result)
			: Promise.resolve(result);
	};
}

function harness(overrides: Partial<CommuteConfig> = {}) {
	const clock = { now: T0 };
	const logs: string[] = [];
	const store = new MemoryStore();
	const db = new FakeDb();
	const push = new FakePush();
	const boards = new FakeBoards(clock);
	const records = new MemoryRecords();
	const blobs = new MemoryBlobs();
	const busSchedules = new FakeBusSchedules();
	const timetable: TimetablePort = { ...emptyTimetable };
	const config: CommuteConfig = { ...commuteConfig({}), ...overrides };
	/** 지역 노선의 도시 코드(D1 `bus_route.source_city`). 없으면 null. */
	const regionalCities: Record<string, string | null> = {};
	const cityCalls: string[][] = [];
	const core = () =>
		new RunnerCore({
			blobs,
			boards,
			busSchedules: busSchedules.read,
			clock: () => clock.now,
			config,
			log: (line) => logs.push(line),
			plans: db,
			push,
			records,
			regionalRouteCities: (lines) => {
				cityCalls.push(lines);
				return Promise.resolve(
					Object.fromEntries(
						lines.map((line) => [line, regionalCities[line] ?? null])
					)
				);
			},
			secrets: {
				apnsKeyId: "KEYID12345",
				apnsP8: p8Pem,
				apnsTeamId: "TEAMID1234",
				apnsTopic: "com.cmu02.betro",
				fcmServiceAccountJson: FAKE_SERVICE_ACCOUNT,
			},
			sleep: () => Promise.resolve(),
			store,
			timetable,
			timezones: [DEFAULT_TIMEZONE],
			tokens: db,
		});
	return {
		blobs,
		boards,
		busSchedules,
		cityCalls,
		clock,
		config,
		core,
		db,
		logs,
		push,
		records,
		regionalCities,
		store,
		timetable,
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
	"stale-date"?: number;
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
		expect(contentOf(end).nextLegs).toEqual([]);
		const [row] = [...h.db.sessions.values()];
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("plan-removed");
		expect(await sessions(h)).toHaveLength(0);
	});

	test("같은 기기에 새 세션이 열리면 앞의 세션에 종료를 보내고 replaced로 닫는다", async () => {
		const h = harness();
		addAndroid(h);
		const later = makePlan(PLAN_ANDROID_2);
		later.schedule.leaveMinute += 2;
		h.db.addPlan(ANDROID_INSTALL, later);
		const core = h.core();
		await tickAt(h, core, T0);
		const [firstId] = await onlySession(h);
		await tickAt(h, core, T0 + 2 * MINUTE);

		const ends = h.push.sent.filter((sent) => fcmDataOf(sent).event === "end");
		expect(ends).toHaveLength(1);
		expect(fcmDataOf(ends[0] as SentRequest).sessionId).toBe(firstId);
		const first = h.db.sessions.get(firstId);
		expect(first?.status).toBe("ended");
		expect(first?.endReason).toBe("replaced");
		const [, entry] = await onlySession(h);
		expect(entry.state.planId).toBe(PLAN_ANDROID_2);
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

function sendRecordsOf(
	h: Harness,
	sessionId: string
): Extract<AccuracyRecord, { kind: "send" }>[] {
	return (h.records.rows.get(sessionId) ?? []).filter(
		(record): record is Extract<AccuracyRecord, { kind: "send" }> =>
			record.kind === "send"
	);
}

describe("RunnerCore 시작 푸시의 결과를 모를 때와 설정 오류", () => {
	test("iOS 시작 푸시가 예외로 끝나면 다시 보내지 않고 unconfirmed로 남긴 뒤 Activity 토큰을 기다린다", async () => {
		const h = harness({ busPollMs: 30 * SECOND });
		addIos(h);
		h.push.respond = (sent) =>
			apsOf(sent).event === "start"
				? new Error("The operation was aborted due to timeout")
				: { reason: null, status: 200 };
		const core = h.core();
		await tickRange(h, core, T0, T0 + 50 * SECOND);
		expect(h.push.sent.map(describeSent)).toEqual(["apns:start"]);

		const [sessionId, entry] = await onlySession(h);
		expect(entry.tokenWaitUntil).toBe(T0 + h.config.tokenWaitMs);
		expect(sendRecordsOf(h, sessionId)).toEqual([
			expect.objectContaining({ outcome: "unconfirmed", reason: "start" }),
		]);

		h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, { sessionId });
		await tickAt(h, core, T0 + 80 * SECOND);
		expect(h.push.sent.map(describeSent)).toEqual([
			"apns:start",
			"apns:update",
		]);
		expect((h.push.sent.at(-1) as SentRequest).url).toContain(ACTIVITY_TOKEN);
		const [, after] = await onlySession(h);
		expect(after.updatable).toBe(true);
	});

	test("결과를 모르는 iOS 시작 뒤 Activity 토큰이 끝내 오지 않으면 갱신 불가로 두고 시작은 한 번이다", async () => {
		const h = harness();
		addIos(h);
		h.push.respond = () => new Error("network connection lost");
		const core = h.core();
		await tickRange(h, core, T0, T0 + 3 * MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual(["apns:start"]);
		const [, entry] = await onlySession(h);
		expect(entry.updatable).toBe(false);
		expect(entry.state.stage).not.toBe("ended");
	});

	const retryReplies: PushResult[] = [
		{ reason: "TooManyRequests", status: 429 },
		{ reason: "InternalServerError", status: 500 },
		{ reason: "ServiceUnavailable", status: 503 },
	];
	for (const reply of retryReplies) {
		test(`iOS 시작이 ${reply.status}이면 다음 tick에 다시 보낸다`, async () => {
			const h = harness();
			addIos(h);
			let rejected = false;
			h.push.respond = () => {
				if (!rejected) {
					rejected = true;
					return reply;
				}
				return { reason: null, status: 200 };
			};
			const core = h.core();
			await tickAt(h, core, T0);
			expect(h.push.sent.map(describeSent)).toEqual(["apns:start"]);
			const [sessionId, entry] = await onlySession(h);
			expect(entry.lastContent).toBeNull();
			expect(entry.tokenWaitUntil).toBeNull();

			await tickAt(h, core, T0 + 30 * SECOND);
			expect(h.push.sent.map(describeSent)).toEqual([
				"apns:start",
				"apns:start",
			]);
			expect(sendRecordsOf(h, sessionId).map((r) => r.outcome)).toEqual([
				"retry",
				"ok",
			]);
			await tickAt(h, core, T0 + 60 * SECOND);
			expect(
				h.push.sent.map(describeSent).filter((name) => name === "apns:start")
			).toHaveLength(2);
		});
	}

	test("iOS 시작이 400 TopicDisallowed면 push-rejected로 닫고 더 보내지 않는다", async () => {
		const h = harness();
		addIos(h);
		h.push.respond = () => ({ reason: "TopicDisallowed", status: 400 });
		const core = h.core();
		await tickRange(h, core, T0, T0 + 2 * MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual(["apns:start"]);
		const [row] = [...h.db.sessions.values()];
		expect(row?.status).toBe("ended");
		expect(row?.endReason).toBe("push-rejected");
		expect(await sessions(h)).toHaveLength(0);
		// 시작 토큰은 지우지 않는다(토큰 문제가 아니다). 다음 날 다시 시도된다.
		expect(h.db.tokenRows.map((r) => r.kind)).toEqual(["apns-start"]);
		const summary = await summaryOf(h, row?.id ?? "");
		expect(summary?.endReason).toBe("push-rejected");
	});

	test("새로 서명한 JWT도 InvalidProviderToken이면 설정 오류로 보고 닫는다", async () => {
		const h = harness();
		addIos(h);
		h.push.respond = () => ({ reason: "InvalidProviderToken", status: 403 });
		await tickRange(h, h.core(), T0, T0 + MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual(["apns:start", "apns:start"]);
		const [row] = [...h.db.sessions.values()];
		expect(row?.endReason).toBe("push-rejected");
	});

	test("Android 시작이 FCM 403이면 push-rejected로 닫고 더 보내지 않는다", async () => {
		const h = harness();
		addAndroid(h);
		h.push.respond = () => ({ reason: "SENDER_ID_MISMATCH", status: 403 });
		await tickRange(h, h.core(), T0, T0 + 2 * MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual(["fcm:start"]);
		const [row] = [...h.db.sessions.values()];
		expect(row?.endReason).toBe("push-rejected");
		expect(h.db.tokenRows.map((r) => r.kind)).toEqual(["fcm"]);
	});

	test("갱신이 설정 오류로 세 번 실패하면 종료를 한 번 보내고 push-rejected로 닫는다", async () => {
		const h = harness({ busPollMs: 30 * SECOND });
		addIos(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, { sessionId });
		h.push.respond = (sent) =>
			apsOf(sent).event === "update"
				? { reason: "BadTopic", status: 400 }
				: { reason: null, status: 200 };
		await tickRange(h, core, T0 + 30 * SECOND, T0 + 10 * MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual([
			"apns:start",
			"apns:update",
			"apns:update",
			"apns:update",
			"apns:end",
		]);
		const row = h.db.sessions.get(sessionId);
		expect(row?.endReason).toBe("push-rejected");
		expect(await sessions(h)).toHaveLength(0);
	});

	test("Android 갱신의 설정 오류도 세 번에서 멈춘다", async () => {
		const h = harness({ busPollMs: 30 * SECOND });
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		h.push.respond = (sent) =>
			fcmDataOf(sent).event === "update"
				? { reason: "PERMISSION_DENIED", status: 403 }
				: { reason: null, status: 200 };
		await tickRange(h, core, T0 + 30 * SECOND, T0 + 10 * MINUTE);
		expect(h.push.sent.map(describeSent)).toEqual([
			"fcm:start",
			"fcm:update",
			"fcm:update",
			"fcm:update",
			"fcm:end",
		]);
		expect(h.db.sessions.get(sessionId)?.endReason).toBe("push-rejected");
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

	test("다음 차가 기점에서 출발 대기 중이면 푸시와 진행 중 세션에 awaitingDeparture가 실리고, 그대로면 다시 보내지 않는다", async () => {
		const h = harness();
		addAndroid(h);
		// 노선에 달리는 차량이 없고 모든 정류장의 칸이 "출발대기"다(2026-11-12 6411 기점).
		h.boards.handler = () =>
			routeStops([], h.clock.now, h.clock.now).map((stop) => ({
				...stop,
				awaitingDeparture: true,
			}));
		const core = h.core();
		await tickAt(h, core, T0);
		const first = contentOf(h.push.sent.at(-1) as SentRequest);
		expect(first.awaitingDeparture).toBe(true);
		expect(first.stopsAway).toBeNull();
		expect(first.positionState).toBe("live");
		expect(
			(await core.activeSession(ANDROID_INSTALL))?.content.awaitingDeparture
		).toBe(true);

		const before = h.push.sent.length;
		await tickAt(h, core, T0 + 20 * SECOND);
		expect(h.push.sent.length).toBe(before);
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

	test("버스 도착판이 없으면 정적 배차간격의 반을 더한 추정을 쓴다", async () => {
		const h = harness();
		addAndroid(h);
		h.boards.handler = () => new UpstreamStoppedError("auth");
		h.busSchedules.handler = (ids) =>
			Object.fromEntries(
				ids.map((id) => [
					id,
					{ firstBusMinute: null, headwayMin: 10, lastBusMinute: null },
				])
			);
		await tickAt(h, h.core(), T0);
		expect(h.busSchedules.calls.at(-1)).toEqual([`seoul-bus:${ROUTE_ID}`]);
		const [, entry] = await onlySession(h);
		const leg = entry.state.estimates[0]?.legs[0];
		expect(leg?.method).toBe("headway");
		expect(leg?.positionState).toBe("none");
		expect(leg?.etaState).toBe("estimated");
		expect(leg?.boardEtaAt).not.toBeNull();
	});

	test("정적 일정을 읽지 못해도 tick은 계속 가고 시각은 null로 둔다", async () => {
		const h = harness();
		addAndroid(h);
		h.boards.handler = () => new UpstreamStoppedError("auth");
		h.busSchedules.handler = () => new Error("D1 down");
		await tickAt(h, h.core(), T0);
		const [, entry] = await onlySession(h);
		const leg = entry.state.estimates[0]?.legs[0];
		expect(leg?.method).toBe("headway");
		expect(leg?.boardEtaAt).toBeNull();
		expect(h.logs.some((line) => line.includes("bus schedules"))).toBe(true);
		expect(h.push.sent.length).toBeGreaterThan(0);
	});

	test("버스 구간이 없으면 정적 일정을 읽지 않는다", async () => {
		const h = harness();
		h.db.addPlan(ANDROID_INSTALL, makeSubwayPlan(PLAN_ANDROID));
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		await tickAt(h, h.core(), T0);
		expect(await sessions(h)).toHaveLength(1);
		expect(h.busSchedules.calls).toEqual([]);
	});

	test("GBIS 구간 하나로 된 세션은 서울 도착 정보와 예산을 쓰지 않고 배차간격의 반으로 승차를 추정한다", async () => {
		const h = harness();
		h.db.addPlan(ANDROID_INSTALL, makeRegionalPlan(PLAN_ANDROID));
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		h.busSchedules.handler = tenMinuteHeadway([`gbis:${ROUTE_ID}`]);
		await tickAt(h, h.core(), T0);
		expect(h.boards.busCalls).toEqual([]);
		expect(await h.store.get(`budget:${SERVICE_DATE}`)).toBeUndefined();
		expect(await h.store.get(`busRoute:${ROUTE_ID}`)).toBeUndefined();
		expect(h.busSchedules.calls.at(-1)).toEqual([`gbis:${ROUTE_ID}`]);
		const [, entry] = await onlySession(h);
		// 나가는 시각 08:05 + 첫 도보 5분에 승차 정류장에 선다.
		expect(entry.state.readyAt).toBe(T0 + 15 * MINUTE);
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			boardEtaAt: T0 + 20 * MINUTE,
			etaState: "estimated",
			method: "headway",
			positionState: "none",
		});
		expect(h.push.sent.length).toBeGreaterThan(0);

		await tickAt(h, h.core(), T0 + TICK_STEP);
		expect(h.boards.busCalls).toEqual([]);
		expect(await h.store.get(`budget:${SERVICE_DATE}`)).toBeUndefined();
	});

	test("기본 경로의 GBIS 구간이 가까워도 노선 ID가 같은 서울 대안 노선을 짧은 간격으로 부르지 않는다", async () => {
		const h = harness({ busNearWindowMs: 60 * MINUTE });
		const plan = makePlan(PLAN_ANDROID);
		const seoulRoute = plan.routes[0] as Route;
		plan.routes = [
			{ legs: [regionalLeg()], rank: 0, walkMinutes: [5, 3] },
			{ ...seoulRoute, rank: 1 },
		];
		h.db.addPlan(ANDROID_INSTALL, plan);
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		h.busSchedules.handler = tenMinuteHeadway([`gbis:${ROUTE_ID}`]);
		const core = h.core();
		await tickAt(h, core, T0);
		const [, entry] = await onlySession(h);
		expect(entry.state.estimates[0]?.legs[0]?.boardEtaAt).toBe(
			T0 + 20 * MINUTE
		);
		expect(h.boards.busCalls).toEqual([ROUTE_ID]);
		// 가까운 차량의 간격(busNearPollMs)은 지났지만 보통 간격(busPollMs)은 아직이다.
		await tickAt(h, core, T0 + h.config.busNearPollMs);
		expect(h.boards.busCalls).toEqual([ROUTE_ID]);
	});

	test("제안을 따라가는 GBIS 구간은 서울 도착 정보를 부르지 않는다", async () => {
		const h = harness();
		await h.store.put("follow:cccccccc-0000-4000-8000-000000000001", {
			items: [{ done: false, leg: regionalLeg(), vehicleId: "V1" }],
			serviceDate: SERVICE_DATE,
			until: null,
		});
		await tickAt(h, h.core(), T0);
		expect(h.boards.busCalls).toEqual([]);
		expect(await h.store.get(`budget:${SERVICE_DATE}`)).toBeUndefined();
		expect(h.busSchedules.calls.at(-1)).toEqual([`gbis:${ROUTE_ID}`]);
	});

	test("서울 구간과 GBIS 구간이 섞이면 서울 노선만 부르고 두 노선의 일정을 전체 노선 ID로 읽는다", async () => {
		const h = harness();
		const plan = makePlan(PLAN_ANDROID);
		const [seoulLeg] = (plan.routes[0] as Route).legs;
		plan.routes = [
			{
				legs: [seoulLeg as BusLeg, regionalLeg()],
				rank: 0,
				walkMinutes: [5, 2, 3],
			},
		];
		h.db.addPlan(ANDROID_INSTALL, plan);
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		await tickAt(h, h.core(), T0);
		expect(await sessions(h)).toHaveLength(1);
		expect(h.boards.busCalls).toEqual([ROUTE_ID]);
		expect(await h.store.get<number>(`budget:${SERVICE_DATE}`)).toBe(1);
		expect([...(h.busSchedules.calls.at(-1) ?? [])].sort()).toEqual([
			`gbis:${ROUTE_ID}`,
			`seoul-bus:${ROUTE_ID}`,
		]);
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

describe("RunnerCore 지역 버스", () => {
	/** 서울 6411 한 구간 뒤에 GBIS 구간. 대안(rank 1)은 TAGO 한 구간. */
	function mixedPlan(): CommutePlan {
		const plan = makePlan(PLAN_ANDROID);
		const [seoulLeg] = (plan.routes[0] as Route).legs;
		plan.routes = [
			{
				legs: [seoulLeg as BusLeg, regionalLeg()],
				rank: 0,
				walkMinutes: [5, 2, 3],
			},
			{ legs: [tagoLeg()], rank: 1, walkMinutes: [5, 3] },
		];
		return plan;
	}

	function addRegional(h: Harness, plan: CommutePlan): void {
		h.db.addPlan(ANDROID_INSTALL, plan);
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
	}

	const callsOf = (h: Harness, source: RegionalSource) =>
		h.boards.regionalCalls.filter((call) => call.source === source);

	test("gbis 구간 세션은 승차 정류장 도착을 부르고 ETA가 official이다", async () => {
		const h = harness();
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		simulateRegional(h);
		await tickAt(h, h.core(), T0);
		expect(h.boards.regionalCalls).toEqual([
			{ routeId: ROUTE_ID, seq: BOARD_SEQ, source: "gbis" },
		]);
		// 탈 차량을 따라가지 않는 GBIS 승차 전 구간은 위치 목록을 부르지 않는다.
		expect(h.boards.locationCalls).toEqual([]);
		expect(h.boards.busCalls).toEqual([]);
		expect(await h.store.get(`budget:${SERVICE_DATE}`)).toBeUndefined();
		expect(
			await h.store.get<number>(`budget:gbis-arrival:${SERVICE_DATE}`)
		).toBe(1);
		const [, entry] = await onlySession(h);
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			boardEtaAt: V1_AT_BOARD,
			etaState: "live",
			method: "official",
			vehicleId: "V1",
		});
	});

	test("GBIS 한도 초과는 GBIS만 그날 멈추고 서울 버스 구간은 계속 부른다", async () => {
		const h = harness();
		addRegional(h, mixedPlan());
		h.regionalCities[TAGO_LINE] = TAGO_CITY;
		simulateRegional(h);
		const simulated = h.boards.regionalArrivalHandler;
		h.boards.regionalArrivalHandler = (route, stop) =>
			route.source === "gbis"
				? new UpstreamStoppedError("quota-exhausted", "gbis")
				: (simulated?.(route, stop) ?? null);
		const core = h.core();
		await tickAt(h, core, T0);
		expect(callsOf(h, "gbis")).toHaveLength(1);
		expect(callsOf(h, "tago")).toHaveLength(1);
		expect(await h.store.get(`stopped:gbis:${SERVICE_DATE}`)).toBeDefined();
		expect(await h.store.get(`stopped:${SERVICE_DATE}`)).toBeUndefined();
		expect(await h.store.get(`stopped:tago:${SERVICE_DATE}`)).toBeUndefined();

		const busBefore = h.boards.busCalls.length;
		await tickAt(h, core, T0 + h.config.busPollMs);
		expect(callsOf(h, "gbis")).toHaveLength(1);
		expect(callsOf(h, "tago").length).toBeGreaterThan(1);
		expect(h.boards.busCalls.length).toBeGreaterThan(busBefore);
		const [, entry] = await onlySession(h);
		const primary = entry.state.estimates.find((e) => e.rank === 0);
		expect(primary?.legs[0]?.method).toBe("official");
		expect(primary?.legs[1]?.method).toBe("headway");
		expect(
			entry.state.estimates.find((e) => e.rank === 1)?.legs[0]?.method
		).toBe("official");
	});

	test("TAGO 일시 오류(null)는 멈추지 않고 직전 도착판을 남긴다", async () => {
		const h = harness();
		addRegional(h, makeTagoPlan(PLAN_ANDROID));
		h.regionalCities[TAGO_LINE] = TAGO_CITY;
		simulateRegional(h);
		const core = h.core();
		await tickAt(h, core, T0);
		// 승차 전에도 차량 번호를 붙이려고 위치 목록을 함께 부른다.
		expect(h.boards.regionalCalls).toEqual([
			{ routeId: TAGO_ROUTE_ID, seq: BOARD_SEQ, source: "tago" },
		]);
		expect(h.boards.locationCalls).toEqual([
			{ routeId: TAGO_ROUTE_ID, source: "tago" },
		]);
		let [, entry] = await onlySession(h);
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			method: "official",
			vehicleId: "V1",
		});

		h.boards.regionalArrivalHandler = () => null;
		h.boards.regionalLocationsHandler = () => null;
		await tickAt(h, core, T0 + h.config.busPollMs);
		// 재시도는 한 번이고 예산은 시도마다 센다. 도착이 없으면 차량 번호를 붙일 일이 없어
		// 위치 목록은 부르지 않는다.
		expect(h.boards.regionalCalls).toHaveLength(3);
		expect(h.boards.locationCalls).toHaveLength(1);
		expect(
			await h.store.get<number>(`budget:tago-arrival:${SERVICE_DATE}`)
		).toBe(3);
		expect(await h.store.get(`stopped:tago:${SERVICE_DATE}`)).toBeUndefined();
		[, entry] = await onlySession(h);
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			method: "official",
			vehicleId: "V1",
		});
	});

	test("출처별 하루 예산을 다 쓰면 그 출처만 부르지 않는다", async () => {
		const h = harness({ dailyBudgetGbisArrival: 1 });
		addRegional(h, mixedPlan());
		h.regionalCities[TAGO_LINE] = TAGO_CITY;
		simulateRegional(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const tagoBefore = callsOf(h, "tago").length;
		await tickAt(h, core, T0 + h.config.busPollMs);
		expect(callsOf(h, "gbis")).toHaveLength(1);
		expect(callsOf(h, "tago").length).toBeGreaterThan(tagoBefore);
		expect(h.boards.busCalls).toHaveLength(2);
		expect(
			await h.store.get<number>(`budget:gbis-arrival:${SERVICE_DATE}`)
		).toBe(1);
	});

	/** 08:11:24에 승차 정류장을 지나는 V1을 잡고 08:12:30 poll까지 간다. */
	async function rideV1(h: Harness, core: RunnerCore): Promise<void> {
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		simulateRegional(h);
		await tickRange(h, core, T0, T0 + 16.5 * MINUTE);
	}

	test("잡은 GBIS 차량이 승차 정류장 도착에서 빠지면 그 poll에 위치 목록을 불러 탄 것을 안다", async () => {
		const h = harness();
		const core = h.core();
		await rideV1(h, core);
		const [, entry] = await onlySession(h);
		expect(entry.state.stage).toBe("ride");
		expect(entry.state.fixed[0]).toBe("V1");
		expect(h.boards.locationCalls).toEqual([
			{ routeId: ROUTE_ID, source: "gbis" },
		]);
	});

	test("잡은 GBIS 차량이 승차 정류장 도착에서 빠진 poll에 위치 목록을 못 읽어도 그 차량을 두고, 탔어요를 누르면 그 차량을 탄다", async () => {
		const h = harness();
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		simulateRegional(h);
		const simulatedLocations = h.boards.regionalLocationsHandler;
		const core = h.core();
		await tickRange(h, core, T0, T0 + 16 * MINUTE);
		let [sessionId, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");

		// 08:11:30 poll: V1이 승차 정류장 도착에서 빠졌는데 위치 목록이 응답하지 않는다.
		h.boards.regionalLocationsHandler = () => null;
		await tickAt(h, core, T0 + 16.5 * MINUTE);
		expect(h.boards.locationCalls.length).toBeGreaterThan(0);
		[sessionId, entry] = await onlySession(h);
		// 지났는지 모르니 그 정류장은 직전 도착을 두고, 잡은 V1을 놓지 않는다.
		expect(entry.state.fixed[0]).toBe("V1");
		expect(entry.state.estimates[0]?.legs[0]?.vehicleId).toBe("V1");

		h.clock.now = T0 + 16.5 * MINUTE + 10 * SECOND;
		expect(
			await core.input(ANDROID_INSTALL, sessionId, { kind: "boarded" })
		).toBe("ok");
		[, entry] = await onlySession(h);
		expect(entry.state.stage).toBe("ride");
		expect(entry.state.fixed[0]).toBe("V1");

		// 다음 poll에 위치 목록이 돌아오면 V1을 계속 따라간다.
		h.boards.regionalLocationsHandler = simulatedLocations;
		await tickAt(h, core, T0 + 17 * MINUTE);
		[, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");
		expect(entry.state.estimates[0]?.legs[0]?.vehicleId).toBe("V1");
	});

	test("위치 목록을 못 읽은 다음 poll에 다시 부르면 GBIS 차량이 지난 것을 알고 탄 것으로 본다", async () => {
		const h = harness();
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		simulateRegional(h);
		const simulatedLocations = h.boards.regionalLocationsHandler;
		const core = h.core();
		await tickRange(h, core, T0, T0 + 16 * MINUTE);
		h.boards.regionalLocationsHandler = () => null;
		await tickAt(h, core, T0 + 16.5 * MINUTE);
		let [, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");

		h.boards.regionalLocationsHandler = simulatedLocations;
		await tickAt(h, core, T0 + 17 * MINUTE);
		[, entry] = await onlySession(h);
		expect(entry.state.stage).toBe("ride");
		expect(entry.state.fixed[0]).toBe("V1");
	});

	test("GBIS 도착에서 한 poll만 빠진 차량이 위치 목록에서 아직 승차 정류장 앞이면 잡은 채로 둔다", async () => {
		const h = harness();
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		simulateRegional(h);
		const simulated = h.boards.regionalArrivalHandler;
		const core = h.core();
		await tickRange(h, core, T0, T0 + 9 * MINUTE);
		let [, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");

		// 한 poll 동안 도착 응답에서 V1만 빠진다(위치 목록에는 순번 23쯤에 있다).
		h.boards.regionalArrivalHandler = (route, stop) => {
			const found = simulated?.(route, stop) ?? null;
			if (!found || found instanceof Error) {
				return found;
			}
			return {
				...found,
				vehicles: found.vehicles.filter(
					(vehicle) => vehicle.vehicleId !== "V1"
				),
			};
		};
		await tickAt(h, core, T0 + 10 * MINUTE);
		[, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");

		h.boards.regionalArrivalHandler = simulated;
		await tickAt(h, core, T0 + 11 * MINUTE);
		[, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			boardEtaAt: V1_AT_BOARD,
			method: "official",
			vehicleId: "V1",
		});
	});

	test("탄 뒤에는 하차 정류장 도착과 위치 목록을 부른다", async () => {
		const h = harness();
		const core = h.core();
		await rideV1(h, core);
		h.boards.regionalCalls.length = 0;
		h.boards.locationCalls.length = 0;
		await tickRange(h, core, T0 + 17 * MINUTE, T0 + 17.5 * MINUTE);
		expect(h.boards.regionalCalls).toEqual([
			{ routeId: ROUTE_ID, seq: ALIGHT_SEQ, source: "gbis" },
		]);
		expect(h.boards.locationCalls).toEqual([
			{ routeId: ROUTE_ID, source: "gbis" },
		]);
		expect(
			await h.store.get<number>(`budget:gbis-location:${SERVICE_DATE}`)
		).toBe(2);
		const [, entry] = await onlySession(h);
		expect(entry.state.stage).toBe("ride");
		expect(entry.state.estimates[0]?.legs[0]?.alightEtaAt).not.toBeNull();
	});

	test("순번이 5분 넘게 그대로인 GBIS 차량은 저장 전에 빠지고, 다른 차량이 없으면 배차간격 추정으로 간다", async () => {
		const h = harness();
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		h.busSchedules.handler = tenMinuteHeadway([`gbis:${ROUTE_ID}`]);
		// 차량은 07:55 자리에 멈춰 있고, 응답 시각만 흐른다.
		simulateRegional(h, () => T0);
		const core = h.core();
		await tickRange(h, core, T0, T0 + 5 * MINUTE);
		let [, entry] = await onlySession(h);
		expect(entry.state.estimates[0]?.legs[0]?.method).toBe("official");

		await tickAt(h, core, T0 + 6 * MINUTE);
		const saved = await h.store.get<{
			data: {
				now: RouteStopArrival[];
				positions: Record<string, number>;
			} | null;
		}>(`regionalBus:gbis:${ROUTE_ID}`);
		expect(saved?.data?.now.flatMap((stop) => stop.vehicles)).toEqual([]);
		expect(saved?.data?.positions).toEqual({});
		[, entry] = await onlySession(h);
		// 잡아 둔 V1이 빠졌으니 놓고 다시 고른다. 건너뛴 차량으로 보지는 않는다.
		expect(entry.state.fixed[0]).toBeNull();
		expect(entry.state.skip).toEqual([]);
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			etaState: "estimated",
			method: "headway",
		});
	});

	test("잡아 둔 GBIS 차량만 멈췄으면 다음 차량의 공식 ETA로 넘어간다", async () => {
		const h = harness();
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		h.busSchedules.handler = tenMinuteHeadway([`gbis:${ROUTE_ID}`]);
		simulateRegional(h);
		const simulated = h.boards.regionalArrivalHandler;
		// V1은 07:55 자리에 멈춰 있고 V2는 달린다.
		h.boards.regionalArrivalHandler = (route, stop) => {
			const moving = simulated?.(route, stop);
			if (!moving || moving instanceof Error) {
				return moving ?? null;
			}
			const frozen = routeStops(
				[{ arriveBoardAt: V1_AT_BOARD + (h.clock.now - T0), id: "V1" }],
				h.clock.now,
				h.clock.now
			).find((found) => found.seq === stop.seq);
			return {
				...moving,
				vehicles: [
					...(frozen?.vehicles ?? []),
					...moving.vehicles.filter((vehicle) => vehicle.vehicleId !== "V1"),
				],
			};
		};
		const core = h.core();
		await tickRange(h, core, T0, T0 + 5 * MINUTE);
		let [, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");

		await tickAt(h, core, T0 + 6 * MINUTE);
		[, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V2");
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			boardEtaAt: V2_AT_BOARD,
			method: "official",
			vehicleId: "V2",
		});
	});

	test("TAGO 위치 목록이 일시 오류여도 승차 ETA는 공식 값이다(차량 번호 대신 tago-pos)", async () => {
		const h = harness();
		addRegional(h, makeTagoPlan(PLAN_ANDROID));
		h.regionalCities[TAGO_LINE] = TAGO_CITY;
		simulateRegional(h);
		const core = h.core();
		await tickAt(h, core, T0);
		let [, entry] = await onlySession(h);
		expect(entry.state.fixed[0]).toBe("V1");

		h.boards.regionalLocationsHandler = () => null;
		await tickAt(h, core, T0 + h.config.busPollMs);
		[, entry] = await onlySession(h);
		expect(entry.state.estimates[0]?.legs[0]).toMatchObject({
			boardEtaAt: V1_AT_BOARD,
			method: "official",
		});
		expect(entry.state.estimates[0]?.legs[0]?.vehicleId).toStartWith(
			"tago-pos:"
		);
	});

	test("도시 코드가 없는 TAGO 노선은 부르지 않고 배차간격 추정으로 둔다", async () => {
		const h = harness();
		addRegional(h, makeTagoPlan(PLAN_ANDROID));
		simulateRegional(h);
		await tickAt(h, h.core(), T0);
		expect(h.cityCalls.at(-1)).toEqual([TAGO_LINE]);
		expect(h.boards.regionalCalls).toEqual([]);
		expect(h.boards.locationCalls).toEqual([]);
		const [, entry] = await onlySession(h);
		expect(entry.state.estimates[0]?.legs[0]?.method).toBe("headway");
	});

	test("지역 구간의 경로 보기는 지도 용도라 출처 예산의 3분의 1을 세션 몫으로 남긴다", async () => {
		const h = harness({ dailyBudgetGbisArrival: 3 });
		simulateRegional(h);
		const route: Route = {
			legs: [regionalLeg()],
			rank: 0,
			walkMinutes: [5, 3],
		};
		const core = h.core();
		const first = await core.routeView(route, T0);
		expect(first.legs[0]?.method).toBe("official");
		h.clock.now = T0 + h.config.busPollMs;
		await core.routeView(route, h.clock.now);
		expect(h.boards.regionalCalls).toHaveLength(2);

		h.clock.now = T0 + 2 * h.config.busPollMs;
		const cached = await core.routeView(route, h.clock.now);
		expect(h.boards.regionalCalls).toHaveLength(2);
		expect(cached.legs[0]?.approaching.length).toBeGreaterThan(0);
		expect(h.logs.some((line) => line.includes("map share"))).toBe(true);

		// 거절된 지도 호출은 폴링 시각을 찍지 않아 바로 뒤 세션 tick이 부른다.
		addRegional(h, makeRegionalPlan(PLAN_ANDROID));
		await tickAt(h, core, h.clock.now);
		expect(h.boards.regionalCalls).toHaveLength(3);
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

describe("RunnerCore 진행 중 세션의 경로별 예상", () => {
	function suggestHarness(): Harness {
		const h = harness();
		h.db.addPlan(ANDROID_INSTALL, makeSuggestPlan(PLAN_ANDROID));
		h.db.addToken(ANDROID_INSTALL, "fcm", FCM_TOKEN, { env: "production" });
		h.boards.handler = (routeId) =>
			routeStops(
				routeId === ALT_ROUTE_ID
					? [{ arriveBoardAt: T0 + 12 * MINUTE, id: "A1" }]
					: h.boards.vehicles,
				h.clock.now,
				h.clock.now
			);
		return h;
	}

	test("대안이 있으면 rank 오름차순으로 경로마다 하나씩 싣고 시각은 초 단위다", async () => {
		const h = suggestHarness();
		const core = h.core();
		await tickAt(h, core, T0);
		const [, entry] = await onlySession(h);
		const active = await core.activeSession(ANDROID_INSTALL);
		expect(active?.routes.map((route) => route.rank)).toEqual([0, 1]);
		const alt = entry.state.estimates.find((estimate) => estimate.rank === 1);
		expect(alt?.destinationEtaAt).not.toBeNull();
		const altView = active?.routes[1];
		expect(altView?.destinationEtaEpoch).toBe(
			Math.floor((alt?.destinationEtaAt ?? 0) / 1000)
		);
		expect(altView?.boardEtaEpoch).toBe(
			Math.floor((alt?.legs[0]?.boardEtaAt ?? 0) / 1000)
		);
		const primary = entry.state.estimates.find(
			(estimate) => estimate.rank === 0
		);
		const primaryLeg = primary?.legs[entry.state.legIndex];
		expect(primaryLeg).toBeDefined();
		const primaryBoardAt = primaryLeg?.boardEtaAt ?? null;
		expect(active?.routes[0]).toMatchObject({
			boardEtaEpoch:
				primaryBoardAt === null ? null : Math.floor(primaryBoardAt / 1000),
			destinationEtaEpoch: Math.floor((primary?.destinationEtaAt ?? 0) / 1000),
			etaState: primaryLeg?.etaState,
			positionState: primaryLeg?.positionState,
			rank: 0,
			stopsAway: primaryLeg?.stopsAway,
		});
	});

	test("active session exposes legVehicleIds per route, using fixed for boarded legs", async () => {
		const h = suggestHarness();
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId, entry] = await onlySession(h);
		const estimateOf = (rank: number) =>
			entry.state.estimates.find((estimate) => estimate.rank === rank);
		const before = await core.activeSession(ANDROID_INSTALL);
		expect(before?.routes[0]?.legVehicleIds).toEqual(
			estimateOf(0)?.legs.map((leg) => leg.vehicleId)
		);
		expect(before?.routes[1]?.legVehicleIds).toEqual(
			estimateOf(1)?.legs.map((leg) => leg.vehicleId)
		);
		expect(before?.routes[1]?.legVehicleIds[0]).toBe("A1");
		await h.store.put(`session:${sessionId}`, {
			...entry,
			state: {
				...entry.state,
				fixed: entry.state.fixed.map(() => "BOARDED"),
			},
		});
		const after = await core.activeSession(ANDROID_INSTALL);
		expect(after?.routes[0]?.legVehicleIds).toEqual(
			entry.state.fixed.map(() => "BOARDED")
		);
		expect(after?.routes[1]?.legVehicleIds).toEqual(
			before?.routes[1]?.legVehicleIds
		);
	});

	test("추정이 아직 없으면 시각은 null이고 etaState는 estimated, positionState는 none이다", async () => {
		const h = suggestHarness();
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId, entry] = await onlySession(h);
		await h.store.put(`session:${sessionId}`, {
			...entry,
			state: { ...entry.state, estimates: [] },
		});
		const active = await core.activeSession(ANDROID_INSTALL);
		expect(active?.routes).toEqual(
			[0, 1].map((rank) => ({
				boardEtaEpoch: null,
				destinationEtaEpoch: null,
				etaState: "estimated",
				legVehicleIds: [],
				positionState: "none",
				rank,
				stopsAway: null,
			}))
		);
	});

	test("대안이 없는 경로는 routes가 1개다", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const active = await core.activeSession(ANDROID_INSTALL);
		expect(active?.routes).toHaveLength(1);
		expect(active?.routes[0]?.rank).toBe(0);
	});
});

describe("RunnerCore 경로 보기", () => {
	const MISSING_ROUTE_ID = "999999999";

	function busRoute(): Route {
		return makePlan(PLAN_ANDROID).routes[0] as Route;
	}

	test("지도 용도는 daily − reserve에 닿으면 부르지 않고 캐시만 쓰며, 세션 용도는 계속 부른다", async () => {
		const h = harness({
			busArrivalSessionReserve: 2,
			dailyBudgetBusArrival: 3,
		});
		const core = h.core();
		await core.routeView(busRoute(), T0);
		expect(h.boards.busCalls).toHaveLength(1);

		const later = T0 + h.config.busPollMs;
		h.clock.now = later;
		const cached = await core.routeView(busRoute(), later);
		expect(h.boards.busCalls).toHaveLength(1);
		expect(await h.store.get<number>(`budget:${SERVICE_DATE}`)).toBe(1);
		expect(cached.legs[0]?.approaching.length).toBeGreaterThan(0);
		expect(h.logs.some((line) => line.includes("map share"))).toBe(true);

		// 거절된 지도 호출이 폴링 시각을 찍지 않아야 바로 뒤 세션 tick이 상류를 부른다.
		addAndroid(h);
		await tickAt(h, core, later);
		expect(await sessions(h)).toHaveLength(1);
		expect(h.boards.busCalls).toHaveLength(2);

		await tickRange(h, core, later + TICK_STEP, later + 6 * MINUTE);
		expect(h.boards.busCalls).toHaveLength(3);
		expect(await h.store.get<number>(`budget:${SERVICE_DATE}`)).toBe(3);
	});

	test("경로 보기는 노선별 도착정보 캐시를 함께 쓴다: busPollMs 안의 두 번은 한 번만 부른다", async () => {
		const h = harness();
		const core = h.core();
		await core.routeView(busRoute(), T0);
		h.clock.now = T0 + h.config.busPollMs - SECOND;
		await core.routeView(busRoute(), h.clock.now);
		expect(h.boards.busCalls).toEqual([ROUTE_ID]);

		// 같은 노선의 출퇴근 세션도 그 캐시를 쓴다.
		addAndroid(h);
		await tickAt(h, core, T0 + TICK_STEP);
		expect(await sessions(h)).toHaveLength(1);
		expect(h.boards.busCalls).toEqual([ROUTE_ID]);

		h.clock.now = T0 + h.config.busPollMs;
		await core.routeView(busRoute(), h.clock.now);
		expect(h.boards.busCalls).toEqual([ROUTE_ID, ROUTE_ID]);
	});

	test("경로 보기는 승차 정류장으로 다가오는 차량과 도착 예상을 돌려준다", async () => {
		const h = harness();
		const view = await h.core().routeView(busRoute(), T0);
		const [leg] = view.legs;
		expect(view.legs).toHaveLength(1);
		expect(leg?.approaching.map((vehicle) => vehicle.vehicleId)).toEqual([
			"V1",
			"V2",
		]);
		const first = leg?.approaching[0];
		expect(Object.keys(first ?? {}).sort()).toEqual([
			"etaAt",
			"method",
			"stopsAway",
			"vehicleId",
		]);
		expect(first?.etaAt).toBe(V1_AT_BOARD);
		expect(first?.stopsAway).not.toBeNull();
		expect(leg).toMatchObject({
			boardEtaAt: V1_AT_BOARD,
			etaState: "live",
			positionState: "live",
			vehicleId: "V1",
		});
		expect(view.destinationEtaAt).not.toBeNull();
		expect(view.destinationEtaAt ?? 0).toBeGreaterThan(V1_AT_BOARD);
	});

	test("지하철 구간은 역 도착판과 시간표 주행 시간으로 계산하고 역을 수집기에 등록한다", async () => {
		const h = harness();
		const RIDE_MS = 2 * MINUTE;
		h.timetable.rideMs = () => Promise.resolve(RIDE_MS);
		h.boards.stationRows[GANGNAM] = {
			fetchedAt: T0 - 5 * SECOND,
			rows: [
				{
					arvlCd: "99",
					barvlSec: 300,
					direction: "down",
					ordkey: "01005역삼0",
					sourceAt: T0 - 5 * SECOND,
					trainNo: "T1",
				},
			],
		};
		const route: Route = {
			...(makeSubwayPlan(PLAN_ANDROID).routes[0] as Route),
			walkMinutes: [0, 3],
		};
		const view = await h.core().routeView(route, T0);
		expect(h.boards.watched.at(-1)).toContain(GANGNAM);
		const [leg] = view.legs;
		expect(leg?.approaching.map((vehicle) => vehicle.vehicleId)).toContain(
			"T1"
		);
		expect(leg?.boardEtaAt).not.toBeNull();
		expect(view.destinationEtaAt).toBe(
			(leg?.boardEtaAt ?? 0) + RIDE_MS + 3 * MINUTE
		);
	});

	test("GBIS 구간의 경로 보기는 서울 도착 정보를 부르지 않고 배차간격의 반으로 승차를 추정한다", async () => {
		const h = harness();
		h.busSchedules.handler = tenMinuteHeadway([`gbis:${ROUTE_ID}`]);
		const route: Route = {
			legs: [regionalLeg()],
			rank: 0,
			walkMinutes: [5, 3],
		};
		const view = await h.core().routeView(route, T0);
		expect(h.boards.busCalls).toEqual([]);
		expect(await h.store.get(`budget:${SERVICE_DATE}`)).toBeUndefined();
		expect(h.busSchedules.calls.at(-1)).toEqual([`gbis:${ROUTE_ID}`]);
		expect(view.legs).toEqual([
			{
				approaching: [],
				boardEtaAt: T0 + 10 * MINUTE,
				etaState: "estimated",
				method: "headway",
				positionState: "none",
				vehicleId: null,
			},
		]);
		expect(view.destinationEtaAt).toBeNull();
	});

	test("D1에 없는 노선의 경로 보기는 던지지 않고 시각이 null인 estimated 구간을 돌려준다", async () => {
		const h = harness();
		h.boards.handler = () => new Error("unknown route");
		const base = busRoute();
		const [leg] = base.legs;
		const route: Route = {
			...base,
			legs: [
				{
					...(leg as BusLeg),
					line: `seoul-bus:${MISSING_ROUTE_ID}`,
				},
			],
		};
		const view = await h.core().routeView(route, T0);
		expect(h.busSchedules.calls.at(-1)).toEqual([
			`seoul-bus:${MISSING_ROUTE_ID}`,
		]);
		expect(view).toEqual({
			destinationEtaAt: null,
			legs: [
				expect.objectContaining({
					approaching: [],
					boardEtaAt: null,
					etaState: "estimated",
					positionState: "none",
				}),
			],
		});
	});
});

describe("RunnerCore 경로 보기의 캐시와 이상한 응답", () => {
	function busRoute(): Route {
		return makePlan(PLAN_ANDROID).routes[0] as Route;
	}

	test("세션이 없는 tick이 끼어도 경로 보기 캐시는 busPollMs 동안 남는다", async () => {
		const h = harness();
		const core = h.core();
		await core.routeView(busRoute(), T0);
		await tickAt(h, core, T0 + 10 * SECOND);
		h.clock.now = T0 + 20 * SECOND;
		await core.routeView(busRoute(), h.clock.now);
		expect(h.boards.busCalls).toEqual([ROUTE_ID]);

		// 간격이 지난 캐시는 세션이 없는 tick이 지운다.
		await tickAt(h, core, T0 + h.config.busPollMs);
		expect(await h.store.get(`busRoute:${ROUTE_ID}`)).toBeUndefined();
	});

	test("상류가 빈 목록(운행 끝)을 주면 던지지 않고 시각 없는 추정이다", async () => {
		const h = harness();
		h.boards.handler = () => [];
		const view = await h.core().routeView(busRoute(), T0);
		expect(view.destinationEtaAt).toBeNull();
		expect(view.legs[0]).toMatchObject({
			approaching: [],
			boardEtaAt: null,
			etaState: "estimated",
		});
	});

	test("정류장 순번이 노선에 없으면(배치가 바뀜) 던지지 않고 시각 없는 추정이다", async () => {
		const h = harness();
		const base = busRoute();
		const leg = base.legs[0] as BusLeg;
		const route: Route = {
			...base,
			legs: [
				{
					...leg,
					alight: { ...leg.alight, seq: LAST_SEQ + 20 },
					board: { ...leg.board, seq: LAST_SEQ + 10 },
				},
			],
		};
		const view = await h.core().routeView(route, T0);
		expect(view.destinationEtaAt).toBeNull();
		expect(view.legs[0]).toMatchObject({
			approaching: [],
			boardEtaAt: null,
			etaState: "estimated",
		});
	});
});

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

// ---------------------------------------------------------------------------
// 나가는 시각의 여유(스펙 4.5~4.7)

/** T0(07:55)부터 m분 s초. 나가는 시각 08:05는 atMinute(10)이다. */
function atMinute(minutes: number, seconds = 0): number {
	return T0 + minutes * MINUTE + seconds * SECOND;
}

/** 밀리초 → epoch 초(ContentState·APNs 단위). */
function epoch(ms: number): number {
	return Math.floor(ms / SECOND);
}

function recordsFor(h: Harness, sessionId: string): AccuracyRecord[] {
	return h.records.rows.get(sessionId) ?? [];
}

function leaveRecordsFor(h: Harness, sessionId: string): AccuracyRecord[] {
	return recordsFor(h, sessionId).filter((record) => record.kind === "leave");
}

async function sessionOfPlan(
	h: Harness,
	planId: string
): Promise<[string, SessionEntry]> {
	const found = (await sessions(h)).find(
		([, entry]) => entry.state.planId === planId
	);
	if (!found) {
		throw new Error(`session of ${planId} missing`);
	}
	return found;
}

describe("RunnerCore 나가는 시각의 여유", () => {
	// V1은 08:11:24에 승차 정류장에 닿는다. 여유 폭 3분, 도보 5분이면 08:03:24에 나가야 해서
	// 08:05는 빠듯하고, 분 단위로 내린 08:03(atMinute(8))에 나가면 여유가 있다.

	test("safe를 실은 값이 retry면 조기 탑승 기준과 leave 기록이 없고, ok로 나가면 둘 다 남는다", async () => {
		const h = harness();
		addAndroid(h);
		h.push.respond = () => ({ reason: null, status: 503 });
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId, failed] = await onlySession(h);
		const tried = contentOf(h.push.sent[0] as SentRequest);
		expect(tried.leaveSlack).toBe("tight");
		expect(tried.safeLeaveEpoch).toBe(epoch(atMinute(8)));
		expect(failed.lastContent).toBeNull();
		expect(failed.state.earlyBoardFrom).toBeNull();
		expect(leaveRecordsFor(h, sessionId)).toEqual([]);

		h.push.respond = () => ({ reason: null, status: 200 });
		await tickAt(h, core, atMinute(0, 30));
		// heartbeat로 같은 값을 다시 보내도 leave 기록은 한 줄이다.
		await tickAt(h, core, atMinute(3));
		const [, sent] = await onlySession(h);
		expect(sent.state.earlyBoardFrom).toEqual({
			at: atMinute(13),
			vehicleId: "V1",
		});
		expect(sent.lastLeave).toEqual({
			safeLeaveAt: atMinute(8),
			shown: "safe",
			vehicleId: "V1",
		});
		expect(leaveRecordsFor(h, sessionId)).toEqual([
			expect.objectContaining({
				at: atMinute(0, 30),
				firstWalkMs: 5 * MINUTE,
				kind: "leave",
				leaveAt: atMinute(10),
				marginSec: 180,
				safeLeaveAt: atMinute(8),
				sessionId,
				shown: "safe",
				vehicleId: "V1",
			}),
		]);
	});

	test("safe를 보낸 뒤 도보가 끝나 wait 값이 나가면 none 기록을 한 줄만 남기고 판정은 safe로 한다", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		// 경계 푸시와 나가는 시각 푸시가 모두 실패해 safe 문장이 도보가 끝날 때까지 남는다.
		h.push.respond = () => ({ reason: null, status: 503 });
		await tickAt(h, core, atMinute(8));
		await tickAt(h, core, atMinute(10));
		await tickAt(h, core, atMinute(15));
		expect(leaveRecordsFor(h, sessionId)).toEqual([
			expect.objectContaining({ at: T0, shown: "safe" }),
		]);

		h.push.respond = () => ({ reason: null, status: 200 });
		await tickAt(h, core, atMinute(15, 30));
		expect(contentOf(h.push.sent.at(-1) as SentRequest).stage).toBe("wait");
		await tickAt(h, core, atMinute(16));
		const [, waiting] = await onlySession(h);
		expect(waiting.lastLeave).toEqual({
			safeLeaveAt: null,
			shown: "none",
			vehicleId: "V1",
		});
		expect(leaveRecordsFor(h, sessionId)).toEqual([
			expect.objectContaining({ at: T0, shown: "safe" }),
			expect.objectContaining({
				at: atMinute(15, 30),
				safeLeaveAt: null,
				shown: "none",
				vehicleId: "V1",
			}),
		]);

		h.clock.now = atMinute(16, 10);
		await core.input(ANDROID_INSTALL, sessionId, { kind: "end" });
		expect((await summaryOf(h, sessionId))?.leave).toMatchObject({
			sawSafe: true,
			shown: "safe",
		});
	});

	test("iOS 갱신이 safe를 실으면 stale-date가 safeLeaveEpoch로 당겨진다", async () => {
		const h = harness();
		addIos(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		h.db.addToken(IOS_INSTALL, "apns-activity", ACTIVITY_TOKEN, {
			sessionId,
		});
		await tickAt(h, core, atMinute(6));
		const update = h.push.sent.at(-1) as SentRequest;
		expect(apsOf(update).event).toBe("update");
		expect(contentOf(update).safeLeaveEpoch).toBe(epoch(atMinute(8)));
		// 기본(now + heartbeat + tick)은 atMinute(8, 20)이다.
		expect(apsOf(update)["stale-date"]).toBe(epoch(atMinute(8)));
	});

	test("업데이트 토큰 전에 safe를 실은 iOS 시작 푸시에도 stale-date가 safeLeaveEpoch로 붙는다", async () => {
		const h = harness();
		addIos(h);
		h.push.respond = () => ({ reason: null, status: 503 });
		const core = h.core();
		await tickAt(h, core, T0);
		h.push.respond = () => ({ reason: null, status: 200 });
		await tickAt(h, core, atMinute(6));
		const start = h.push.sent.at(-1) as SentRequest;
		expect(apsOf(start).event).toBe("start");
		expect(contentOf(start).safeLeaveEpoch).toBe(epoch(atMinute(8)));
		expect(apsOf(start)["stale-date"]).toBe(epoch(atMinute(8)));
	});

	test("마지막으로 보낸 값의 경계가 다음 tick보다 이르면 그 시각에 깨어나고, 그때 경계 푸시를 보낸다", async () => {
		const h = harness();
		addAndroid(h);
		// 도보 1분이면 08:07:24에 나가도 되니 08:05는 여유가 있다. 경계는 나가는 시각 atMinute(10)뿐이다.
		const roomy = makePlan(PLAN_ANDROID_2);
		roomy.routes = roomy.routes.map((route) => ({
			...route,
			walkMinutes: [1, 3],
		}));
		h.db.addPlan(ANDROID_INSTALL_2, roomy);
		h.db.addToken(ANDROID_INSTALL_2, "fcm", FCM_TOKEN_2, {
			env: "production",
		});
		const core = h.core();
		await tickAt(h, core, T0);
		const [roomyId, roomyEntry] = await sessionOfPlan(h, PLAN_ANDROID_2);
		expect(roomyEntry.lastContent?.leaveSlack).toBe("roomy");

		const woke = await tickAt(h, core, atMinute(7, 50));
		// now + tickMs(atMinute(8, 20))보다 safe 경계 atMinute(8)이 이르다.
		expect(woke.nextAlarmAt).toBe(atMinute(8));

		const next = await tickAt(h, core, atMinute(8));
		const [safeId] = await sessionOfPlan(h, PLAN_ANDROID);
		const boundarySends = (id: string) =>
			recordsFor(h, id).filter(
				(record) => record.kind === "send" && record.reason === "boundary"
			);
		expect(boundarySends(safeId)).toEqual([
			expect.objectContaining({ at: atMinute(8), outcome: "ok" }),
		]);
		expect(boundarySends(roomyId)).toEqual([]);
		expect(next.nextAlarmAt).toBe(atMinute(8, 30));
	});

	test("일찍 나가서 탄 구간이 있는 세션이 닫히면 end 기록의 boardedEarly가 true다", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId, entry] = await onlySession(h);
		entry.state = { ...entry.state, boardedBy: ["early"] };
		await h.store.put(`session:${sessionId}`, entry);
		h.clock.now = atMinute(0, 30);
		expect(await core.input(ANDROID_INSTALL, sessionId, { kind: "end" })).toBe(
			"ok"
		);
		const ends = ndjsonOf(h, sessionId)
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as AccuracyRecord)
			.filter((record) => record.kind === "end");
		expect(ends).toEqual([expect.objectContaining({ boardedEarly: true })]);
		expect((await summaryOf(h, sessionId))?.earlyBoarded).toBe(true);
	});

	test("일찍 타지 않은 세션의 end 기록은 boardedEarly가 false다", async () => {
		const h = harness();
		addAndroid(h);
		const core = h.core();
		await tickAt(h, core, T0);
		const [sessionId] = await onlySession(h);
		h.clock.now = atMinute(0, 30);
		await core.input(ANDROID_INSTALL, sessionId, { kind: "end" });
		const end = ndjsonOf(h, sessionId)
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as AccuracyRecord)
			.find((record) => record.kind === "end");
		expect(end).toMatchObject({ boardedEarly: false });
	});
});

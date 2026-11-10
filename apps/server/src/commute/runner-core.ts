import {
	dueStart,
	localParts,
	startMinutesToCheck,
} from "@Betro/commute/calendar";
import { DEFAULT_TIMEZONE } from "@Betro/commute/config";
import type { CommutePlan, Leg, SubwayLeg } from "@Betro/commute/plan";
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
import { parseRef } from "@Betro/commute/refs";
import {
	activityAttributes,
	buildContent,
	type ContentState,
	decideSend,
} from "@Betro/commute/session/content";
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
import type { RouteStopArrival } from "@Betro/commute/sources/seoul-bus";
import type { StationRow } from "@Betro/commute/sources/seoul-subway";
import type { TransitBoards } from "@Betro/commute/sources/types";
import { FCM_PROJECT_ID } from "@Betro/realtime/alerts";
import { redactKeys } from "@Betro/realtime/upstream/urls";
import { RETRY_BACKOFF_MS } from "../collector/upstream-call";
import { errorText, runLimited, secretVariants } from "../collector/util";
import type { PushTokenRow } from "./auth";
import { type RunnerPorts, UpstreamStoppedError } from "./ports";

const SESSION_PREFIX = "session:";
/** 끝난 세션(설치 ID, 종료 시각). 끝난 세션의 입력에 "ended"를 돌려주려고 하루 남긴다. */
const ENDED_PREFIX = "ended:";
const BUS_PREFIX = "busRoute:";
/** 역별 직전·지금 행. 수집기는 최근 행만 주므로 `passed`를 찾으려고 직전 것을 둔다. */
const STATION_PREFIX = "station:";
const BUDGET_PREFIX = "budget:";
const STOPPED_PREFIX = "stopped:";
const APNS_JWT_KEY = "apnsJwt";
const FCM_ACCESS_KEY = "fcmAccess";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** 세션이 보는 역을 수집기에 등록해 두는 시간. tick마다 늘린다. */
const WATCH_MS = 5 * MINUTE_MS;
const TIMETABLE_REFRESH_MS = 10 * MINUTE_MS;
const TIMETABLE_ARRIVALS = 6;
const ENDED_KEEP_MS = DAY_MS;
const HOLIDAY_COUNTRY = "KR";
const TOKEN_SHOWN_LENGTH = 8;
/** 키를 지운 로그에도 남을 수 있는 키 모양: 쿼리 `serviceKey=…`, 서울 지하철 경로의 키. */
const KEY_QUERY = /((?:service)?key=)[^&\s"']+/gi;
const SUBWAY_KEY_PATH = /(\/api\/subway\/)[^/\s"']+/g;
const PEM_LINE_BREAK = /\r?\n|\\n/;
const MIN_SECRET_LINE = 16;

type Platform = "ios" | "android";
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
	lastSentAt: number | null;
	platform: Platform | null;
	serviceDate: string;
	/** 기기가 처음 그린 시각(ack). */
	shownAt: number | null;
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

interface StationEntry {
	fetchedAt: number;
	rows: StationRow[];
}

interface StationSaved {
	cur: StationEntry;
	prev: StationEntry | null;
}

interface EndedMark {
	endedAt: number;
	installId: string;
}

export interface ActiveSession {
	content: ContentState;
	planId: string;
	sessionId: string;
}

export type InputResult = "ok" | "not-found" | "ended";

const sessionKey = (id: string): string => `${SESSION_PREFIX}${id}`;
const nextMinute = (now: number): number =>
	Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
const dayOf = (now: number): string => localParts(now, DEFAULT_TIMEZONE).date;

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

function subwayLegsOf(plan: CommutePlan): SubwayLeg[] {
	return plan.routes
		.flatMap((route) => route.legs)
		.filter((leg): leg is SubwayLeg => leg.mode === "subway");
}

/** 경로를 지웠을 때 보낼 종료 값. 경로가 없으니 마지막으로 보낸 값을 바탕으로 한다. */
function endedContentFrom(
	last: ContentState,
	state: SessionState,
	now: number
): ContentState {
	return {
		...last,
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
	readonly #warned = new Set<string>();
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
		let content = entry.lastContent;
		if (content === null) {
			const record = await plans.getPlan(entry.state.planId);
			if (!record || record.installId !== installId) {
				return null;
			}
			content = buildContent(entry.state, record.plan, clock(), config);
		}
		return { content, planId: entry.state.planId, sessionId: id };
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

	async #tick(): Promise<{ nextAlarmAt: number }> {
		const { config, store } = this.#ports;
		const now = this.#ports.clock();
		await this.#startDue(now);
		const entries = await store.list<SessionEntry>(SESSION_PREFIX);
		let open = 0;
		if (entries.size > 0) {
			const plans = await this.#plansOf(entries);
			const raw = await this.#rawBoards(entries, plans, now, true);
			const boards = assembleBoards(raw, config);
			// 한 세션씩 차례로 진행한다(JWT·액세스 토큰을 처음 만들 때 겹쳐 만들지 않게).
			await runLimited([...entries], 1, async ([key, entry]) => {
				const id = key.slice(SESSION_PREFIX.length);
				if (await this.#stepSafely(id, entry, plans, boards, now)) {
					open += 1;
				}
			});
		}
		await this.#prune(now, open);
		return { nextAlarmAt: open > 0 ? now + config.tickMs : nextMinute(now) };
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
		const platform = platformOf(await this.#tokens(installId));
		const entry: SessionEntry = {
			dueAt: due.startAt,
			installId,
			lastContent: null,
			lastSentAt: null,
			platform,
			serviceDate: due.serviceDate,
			shownAt: null,
			state: startSession(plan, due, sessionId),
			timetable: { arrivals: {}, rideMs: {} },
			timetableAt: null,
			tokenAt: null,
			tokenWaitUntil: null,
			updatable: true,
		};
		await store.put(sessionKey(sessionId), entry);
		this.#log(
			`commute start session=${sessionId} plan=${plan.planId} platform=${platform ?? "none"}`
		);
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
		pollBus: boolean
	): Promise<RawBoards> {
		const raw: RawBoards = {
			bus: {},
			subway: {},
			timetable: { arrivals: {}, rideMs: {} },
		};
		/** busRouteId → 탈 차량이 가까운 탑승 전 세션이 있는가. */
		const busRoutes = new Map<string, boolean>();
		const stations = new Set<string>();
		const withPlans: [SessionEntry, CommutePlan][] = [];
		for (const entry of entries.values()) {
			const plan = plans.get(entry.state.planId)?.plan;
			if (plan) {
				withPlans.push([entry, plan]);
			}
		}
		for (const [entry, plan] of withPlans) {
			for (const leg of watchedLegs(entry.state, plan)) {
				if (leg.mode === "bus") {
					const routeId = parseRef(leg.line).id;
					const near = this.#isNear(entry, plan, routeId, now);
					busRoutes.set(routeId, (busRoutes.get(routeId) ?? false) || near);
				} else {
					stations.add(parseRef(leg.board.stop).id);
					stations.add(parseRef(leg.alight.stop).id);
				}
			}
		}
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
			this.#collectBus(routeId, near, raw, now, pollBus)
		);
		return raw;
	}

	/** 기본 경로의 지금 구간이 이 노선이고, 탑승 전이며, 잡은 차량이 가까운가. */
	#isNear(
		entry: SessionEntry,
		plan: CommutePlan,
		routeId: string,
		now: number
	): boolean {
		const { state } = entry;
		if (!isBeforeBoarding(state)) {
			return false;
		}
		const leg = plan.routes.find((route) => route.rank === 0)?.legs[
			state.legIndex
		];
		if (leg?.mode !== "bus" || parseRef(leg.line).id !== routeId) {
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
		const { timetable } = this.#ports;
		const arrivals = { ...entry.timetable.arrivals };
		const rideMs = { ...entry.timetable.rideMs };
		const rideAt = Math.max(now, entry.state.leaveAt);
		await Promise.all(
			subwayLegsOf(plan).map(async (leg) => {
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
		entry.timetable = { arrivals, rideMs };
		entry.timetableAt = now;
	}

	async #collectStations(
		statnIds: string[],
		raw: RawBoards,
		now: number
	): Promise<void> {
		if (statnIds.length === 0) {
			return;
		}
		const { boards, store } = this.#ports;
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
				if (fresh && fresh.fetchedAt !== saved?.cur.fetchedAt) {
					saved = { cur: fresh, prev: saved?.cur ?? null };
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
	 * 아니면 `busPollMs`가 지났을 때만 부른다. 같은 노선은 세션이 여럿이어도 한 번이다.
	 */
	async #collectBus(
		routeId: string,
		near: boolean,
		raw: RawBoards,
		now: number,
		poll: boolean
	): Promise<void> {
		const { config, store } = this.#ports;
		const key = `${BUS_PREFIX}${routeId}`;
		let saved = (await store.get<BusRouteSaved>(key)) ?? null;
		const interval = near ? config.busNearPollMs : config.busPollMs;
		if (poll && (saved === null || now - saved.polledAt >= interval)) {
			const stops = await this.#pollBus(routeId, now);
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
		if (saved?.data) {
			raw.bus[routeId] = saved.data;
		}
	}

	/** 시도마다 하루 예산 1건. 응답이 없으면 1초·2초 뒤 두 번까지 다시 부른다. */
	async #pollBus(
		routeId: string,
		now: number
	): Promise<RouteStopArrival[] | null> {
		const day = dayOf(now);
		if (
			(await this.#ports.store.get(`${STOPPED_PREFIX}${day}`)) !== undefined
		) {
			return null;
		}
		return await this.#attemptBus(routeId, day, now, 0);
	}

	async #attemptBus(
		routeId: string,
		day: string,
		now: number,
		attempt: number
	): Promise<RouteStopArrival[] | null> {
		const { boards, config, store } = this.#ports;
		const budgetKey = `${BUDGET_PREFIX}${day}`;
		const used = (await store.get<number>(budgetKey)) ?? 0;
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
		return await this.#attemptBus(routeId, day, now, attempt + 1);
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
		const { config, store } = this.#ports;
		const owned =
			record !== null &&
			record.installId === entry.installId &&
			record.plan.enabled;
		const plan = owned ? record.plan : null;
		entry.state = plan
			? advance(entry.state, plan, boards, now, config, input)
			: endedState(entry.state, "plan-removed");
		const rows = await this.#tokens(entry.installId);
		if (plan === null || entry.state.stage === "ended") {
			await this.#finish(id, entry, plan, rows, now);
			return false;
		}
		const content = buildContent(entry.state, plan, now, config);
		const open =
			entry.lastContent === null
				? await this.#start(id, entry, content, rows, now)
				: await this.#update(id, entry, content, rows, now);
		if (!open) {
			entry.state = endedState(entry.state, "no-token");
			await this.#close(id, entry, rows, now);
			return false;
		}
		await store.put(sessionKey(id), entry);
		return true;
	}

	#sent(entry: SessionEntry, content: ContentState, now: number): void {
		entry.state = { ...entry.state, seq: content.seq };
		entry.lastContent = content;
		entry.lastSentAt = now;
	}

	/** 처음 보내는 세션. 시작 토큰이 없거나 죽었으면 false(no-token으로 닫는다). */
	async #start(
		id: string,
		entry: SessionEntry,
		content: ContentState,
		rows: PushTokenRow[],
		now: number
	): Promise<boolean> {
		const { config, secrets } = this.#ports;
		if (entry.platform === "ios") {
			const row = latestToken(rows, (r) => r.kind === "apns-start");
			if (row === null) {
				return false;
			}
			const outcome = await this.#sendApns(id, row, "start", (jwt) =>
				apnsStartRequest({
					attributes: activityAttributes(entry.state),
					env: row.env,
					jwt,
					now,
					state: content,
					token: row.token,
					topic: secrets.apnsTopic,
				})
			);
			if (outcome === "ok") {
				this.#sent(entry, content, now);
				entry.tokenWaitUntil = now + config.tokenWaitMs;
			}
			return outcome !== "token-dead";
		}
		if (entry.platform === "android") {
			const row = latestToken(rows, (r) => r.kind === "fcm");
			if (row === null) {
				return false;
			}
			const outcome = await this.#sendFcm(id, entry, row, "start", content);
			if (outcome === "ok") {
				this.#sent(entry, content, now);
			}
			return outcome !== "token-dead";
		}
		return false;
	}

	/**
	 * 갱신. iOS는 이 세션의 업데이트 토큰이 있어야 보낸다. 없으면 `tokenWaitUntil`까지 기다리고
	 * 지나면 `updatable: false`로 기록한다(시작은 다시 보내지 않는다). 토큰이 늦게라도 오면 보낸다.
	 */
	async #update(
		id: string,
		entry: SessionEntry,
		content: ContentState,
		rows: PushTokenRow[],
		now: number
	): Promise<boolean> {
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
				return true;
			}
			const outcome = await this.#sendApns(id, row, "update", (jwt) =>
				apnsUpdateRequest({
					env: row.env,
					jwt,
					now,
					priority: decision.priority,
					staleAt: now + config.heartbeatMs + config.tickMs,
					state: content,
					token: row.token,
					topic: secrets.apnsTopic,
				})
			);
			if (outcome === "ok") {
				this.#sent(entry, content, now);
			}
			return true;
		}
		const row = latestToken(rows, (r) => r.kind === "fcm");
		if (row === null) {
			return false;
		}
		if (!decision.send) {
			return true;
		}
		const outcome = await this.#sendFcm(id, entry, row, "update", content);
		if (outcome === "ok") {
			this.#sent(entry, content, now);
		}
		return outcome !== "token-dead";
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
			await this.#sendApns(id, row, "end", (jwt) =>
				apnsEndRequest({
					env: row.env,
					jwt,
					now,
					state: content,
					token: row.token,
					topic: this.#ports.secrets.apnsTopic,
				})
			);
			return;
		}
		const row = latestToken(rows, (r) => r.kind === "fcm");
		if (row !== null) {
			await this.#sendFcm(id, entry, row, "end", content);
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

	async #push(request: Request): Promise<{
		reason: string | null;
		status: number;
	} | null> {
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
	): Promise<PushOutcome> {
		const now = this.#ports.clock();
		let result = await this.#push(build(await this.#apnsJwt(now, false)));
		let outcome = result ? classifyApns(result.status, result.reason) : "retry";
		if (outcome === "jwt-expired") {
			// 서명 키는 그대로이니 새 JWT로 한 번만 다시 보낸다.
			result = await this.#push(build(await this.#apnsJwt(now, true)));
			outcome = result ? classifyApns(result.status, result.reason) : "retry";
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
	): Promise<PushOutcome> {
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
		let outcome = result ? classifyFcm(result.status, result.reason) : "retry";
		if (outcome === "jwt-expired") {
			result = await this.#push(build(await this.#fcmAccess(now, true)));
			outcome = result ? classifyFcm(result.status, result.reason) : "retry";
		}
		if (outcome === "token-dead") {
			await this.#ports.tokens.removeInstall(entry.installId);
		}
		this.#logPush(id, "fcm", event, row, result, outcome);
		return outcome;
	}

	#logPush(
		id: string,
		via: "apns" | "fcm",
		event: string,
		row: PushTokenRow,
		result: { reason: string | null; status: number } | null,
		outcome: PushOutcome
	): void {
		const status = result?.status ?? "none";
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
		const [ended, budgets, stops, buses, stations] = await Promise.all([
			store.list<EndedMark>(ENDED_PREFIX),
			store.list(BUDGET_PREFIX),
			store.list(STOPPED_PREFIX),
			store.list(BUS_PREFIX),
			store.list(STATION_PREFIX),
		]);
		const stale: string[] = [];
		for (const [key, mark] of ended) {
			if (now - mark.endedAt >= ENDED_KEEP_MS) {
				stale.push(key);
			}
		}
		for (const key of budgets.keys()) {
			if (key !== `${BUDGET_PREFIX}${day}`) {
				stale.push(key);
			}
		}
		for (const key of stops.keys()) {
			if (key !== `${STOPPED_PREFIX}${day}`) {
				stale.push(key);
			}
		}
		if (open === 0) {
			// 세션이 없으면 도착판을 들고 있을 이유가 없다.
			stale.push(...buses.keys(), ...stations.keys());
		}
		await Promise.all(stale.map((key) => store.delete(key)));
	}
}

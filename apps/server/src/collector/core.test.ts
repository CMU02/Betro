import type { ReferenceBatchKind } from "@Betro/db/schema/transit";
import type { HistorySummary } from "@Betro/realtime/history";
import type { MetricsBucket } from "@Betro/realtime/metrics";
import {
	type BusReference,
	type BusRouteRef,
	buildSubwayReference,
} from "@Betro/realtime/reference";
import {
	type CollectorConfig,
	devConfig,
	prodConfig,
} from "@Betro/realtime/schedule";
import { SUBWAY_TTL_MS } from "@Betro/realtime/state";
import { describe, expect, it } from "bun:test";
import { gunzipSync } from "node:zlib";
import arrivalSample from "../../../../packages/realtime/src/__fixtures__/arrival-all-sample.json";
import bus150 from "../../../../packages/realtime/src/__fixtures__/bus-150.json";
import bus6411 from "../../../../packages/realtime/src/__fixtures__/bus-6411.json";
import busReferenceFixture from "../../../../packages/realtime/src/__fixtures__/bus-reference-6411-150.json";
import gbisLocation from "../../../../packages/realtime/src/__fixtures__/regional/gbis-location.json";
import tagoGateway04 from "../../../../packages/realtime/src/__fixtures__/regional/tago-gateway-04.json";
import tagoLocation from "../../../../packages/realtime/src/__fixtures__/regional/tago-location.json";
import subwayReferenceFixture from "../../../../packages/realtime/src/__fixtures__/subway-reference-sample.json";
import { SERVICE_ENDED_RECHECK_MS } from "./apply-call";
import { MAX_WATCHED_STATION_TOTAL } from "./collector-state";
import { BACKLOG_RETRY_MS, CollectorCore, DEFAULT_IDLE_FLUSH_MS } from "./core";
import { STATE_KEYS } from "./core-state";
import type {
	BlobStore,
	CollectorKeys,
	CollectorPorts,
	StateStore,
	UpstreamResponse,
} from "./ports";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const STEP = 80 * SECOND;
/** 2026-11-04(수) 05:00 KST */
const T0 = Date.UTC(2026, 10, 3, 20, 0, 0);
/** 2026-11-05(목) 00:50 KST — 운행일 2026-11-04의 끝 무렵 */
const NEAR_END = Date.UTC(2026, 10, 4, 15, 50, 0);
/** 2026-11-05 01:00 KST */
const OPERATING_END = Date.UTC(2026, 10, 4, 16, 0, 0);
/** 2026-11-05 05:00 KST */
const NEXT_START = Date.UTC(2026, 10, 4, 20, 0, 0);
/** 2026-11-05 00:00:10 KST — 새 KST 날, 아직 운행 중 */
const NEXT_KST_DAY = Date.UTC(2026, 10, 4, 15, 0, 10);

const ROUTE_6411 = "100100290";
const ROUTE_150 = "100100029";
const ALL_URL = /realtimeStationArrival\/ALL/;
const ROUTE_PARAM = /busRouteId=(\d+)/;
const HISTORY_PART = /^(.*)-(\d+)\.ndjson\.gz$/;
const GBIS_URL = /\/6410000\/buslocationservice\/v2\/getBusLocationListv2\?/;
const TAGO_URL = /\/1613000\/BusLcInfoInqireService\/getRouteAcctoBusLcList\?/;
const SEOUL_URL = /^http:\/\/ws\.bus\.go\.kr\//;

const ALL_BODY = JSON.stringify(arrivalSample);
const BUS_BODIES: Record<string, string> = {
	[ROUTE_150]: JSON.stringify(bus150),
	[ROUTE_6411]: JSON.stringify(bus6411),
};
const SERVICE_ENDED_BODY = JSON.stringify({
	msgBody: { itemList: null },
	msgHeader: { headerCd: "8", headerMsg: "운행 종료" },
});
const PLAIN_KEYS: CollectorKeys = { bus: "bus-key", subway: "subway-key" };

type Responder = (url: string) => UpstreamResponse | Promise<UpstreamResponse>;

function routeOf(url: string): string | null {
	return ROUTE_PARAM.exec(url)?.[1] ?? null;
}

const ok = (body: string): UpstreamResponse => ({ body, status: 200 });

const fixtureResponder: Responder = (url) => {
	if (ALL_URL.test(url)) {
		return ok(ALL_BODY);
	}
	return ok(BUS_BODIES[routeOf(url) ?? ""] ?? "{}");
};

class MemoryState implements StateStore {
	readonly kv = new Map<string, string>();
	readonly metrics = new Map<string, string>();

	get = <T>(key: string): Promise<T | undefined> => {
		const value = this.kv.get(key);
		return Promise.resolve(
			value === undefined ? undefined : (JSON.parse(value) as T)
		);
	};

	put = (key: string, value: unknown): Promise<void> => {
		this.kv.set(key, JSON.stringify(value));
		return Promise.resolve();
	};

	putMetrics = (bucket: MetricsBucket): Promise<void> => {
		this.metrics.set(
			`${bucket.bucketStart}|${bucket.source}`,
			JSON.stringify(bucket)
		);
		return Promise.resolve();
	};

	metricsSince = (t: number): Promise<MetricsBucket[]> =>
		Promise.resolve(
			[...this.metrics.values()]
				.map((value) => JSON.parse(value) as MetricsBucket)
				.filter((bucket) => bucket.bucketStart >= t)
				.sort((a, b) => a.bucketStart - b.bucketStart)
		);

	pruneMetrics = (before: number): Promise<void> => {
		for (const [key, value] of this.metrics) {
			if ((JSON.parse(value) as MetricsBucket).bucketStart < before) {
				this.metrics.delete(key);
			}
		}
		return Promise.resolve();
	};
}

class MemoryBlobs implements BlobStore {
	readonly objects = new Map<string, Uint8Array>();
	readonly puts: string[] = [];
	/** true면 모든 쓰기가 실패한다(R2 장애). */
	failing: boolean;
	/** 쓰기 직전에 불린다(쓰기 순서 검사용). */
	beforePut: ((key: string) => void) | null;

	constructor() {
		this.failing = false;
		this.beforePut = null;
	}

	put = (
		key: string,
		body: Uint8Array,
		_contentType: string
	): Promise<void> => {
		this.beforePut?.(key);
		if (this.failing) {
			return Promise.reject(new Error("r2 unavailable"));
		}
		this.objects.set(key, body);
		this.puts.push(key);
		return Promise.resolve();
	};

	keys(prefix: string): string[] {
		return [...this.objects.keys()].filter((key) => key.startsWith(prefix));
	}

	/** gzip 이력은 풀어서, 그 밖(보고서)은 그대로 문자열로. */
	text(key: string): string {
		const body = this.objects.get(key) ?? new Uint8Array();
		const raw = key.endsWith(".gz") ? gunzipSync(body) : body;
		return new TextDecoder().decode(raw);
	}
}

function busReference(): BusReference {
	const routes = new Map<string, BusRouteRef>();
	for (const route of Object.values(busReferenceFixture.routes)) {
		routes.set(route.routeId, {
			coords: route.coords as [number, number][],
			lengthM: route.lengthM,
			routeId: route.routeId,
			segmentsBySeq: new Map(route.segments.map((s) => [s.fromSeq, s])),
		});
	}
	return { batchId: busReferenceFixture.batchId, routes };
}

interface Harness {
	batchIds: Record<ReferenceBatchKind, number>;
	blobs: MemoryBlobs;
	/** `loadBus`에 넘어온 노선 ID 목록(부를 때마다 하나). */
	busLoads: string[][];
	calls: { at: number; url: string }[];
	clock: { now: number };
	core: CollectorCore;
	loads: { bus: number; subway: number };
	logs: string[];
	ports: CollectorPorts;
	sent: { body: string; title: string }[];
	state: MemoryState;
}

interface HarnessOptions {
	blobs?: MemoryBlobs;
	clock?: { now: number };
	config?: CollectorConfig;
	idleFlushMs?: number;
	keys?: CollectorKeys;
	respond?: Responder;
	start?: number;
	state?: MemoryState;
}

function makeHarness(options: HarnessOptions = {}): Harness {
	const clock = options.clock ?? { now: options.start ?? T0 };
	const respond = options.respond ?? fixtureResponder;
	const calls: Harness["calls"] = [];
	const logs: string[] = [];
	const sent: Harness["sent"] = [];
	const loads = { bus: 0, subway: 0 };
	const busLoads: string[][] = [];
	const batchIds: Record<ReferenceBatchKind, number> = {
		bus_route: 2,
		station_crosswalk: 8,
		timetable: 9,
		track: 5,
	};
	const state = options.state ?? new MemoryState();
	const blobs = options.blobs ?? new MemoryBlobs();
	const ports: CollectorPorts = {
		blobs,
		clock: () => clock.now,
		config: options.config ?? devConfig({}),
		idleFlushMs: options.idleFlushMs,
		keys: options.keys ?? PLAIN_KEYS,
		log: (line) => {
			logs.push(line);
		},
		notifier: {
			send: (title, body) => {
				sent.push({ body, title });
				return Promise.resolve();
			},
		},
		reference: {
			currentBatchIds: () => Promise.resolve({ ...batchIds }),
			loadBus: (routeIds) => {
				loads.bus += 1;
				busLoads.push([...routeIds]);
				return Promise.resolve(busReference());
			},
			loadSubway: () => {
				loads.subway += 1;
				return Promise.resolve(buildSubwayReference(subwayReferenceFixture));
			},
		},
		sleep: (ms) => {
			clock.now += ms;
			return Promise.resolve();
		},
		state,
		upstream: {
			fetch: (url) => {
				calls.push({ at: clock.now, url });
				return Promise.resolve(respond(url));
			},
		},
	};
	return {
		batchIds,
		blobs,
		busLoads,
		calls,
		clock,
		core: new CollectorCore(ports),
		loads,
		logs,
		ports,
		sent,
		state,
	};
}

/** 시계를 `step`씩 옮기며 `count`번 tick. */
async function runTicks(h: Harness, count: number, step = STEP): Promise<void> {
	if (count <= 0) {
		return;
	}
	await h.core.tick();
	h.clock.now += step;
	await runTicks(h, count - 1, step);
}

/** DO alarm처럼 `nextAlarmAt`으로 시계를 옮기며 `until` 전까지 tick. 마지막 결과를 돌려준다. */
async function runAlarms(h: Harness, until: number): Promise<number> {
	const { nextAlarmAt } = await h.core.tick();
	h.clock.now = Math.max(nextAlarmAt, h.clock.now + 1);
	return h.clock.now < until ? runAlarms(h, until) : nextAlarmAt;
}

/** Cloudflare는 요청·alarm 없이 10초가 지나면 DO를 재우고 메모리를 비운다. */
const HIBERNATION_IDLE_MS = 10 * SECOND;

/**
 * DO alarm처럼 돌리되, 다음 alarm까지 10초 이상 쉬면 메모리를 잃은 것으로 보고 같은 저장소·R2로
 * `CollectorCore`를 새로 만든다. 그동안의 상류 호출을 모두 돌려준다.
 */
async function runHibernatingAlarms(
	h: Harness,
	until: number,
	calls: Harness["calls"] = []
): Promise<Harness["calls"]> {
	const { nextAlarmAt } = await h.core.tick();
	calls.push(...h.calls.splice(0));
	const idle = nextAlarmAt - h.clock.now;
	h.clock.now = Math.max(nextAlarmAt, h.clock.now + 1);
	if (h.clock.now >= until) {
		return calls;
	}
	const next =
		idle >= HIBERNATION_IDLE_MS
			? makeHarness({
					blobs: h.blobs,
					clock: h.clock,
					idleFlushMs: h.ports.idleFlushMs,
					state: h.state,
				})
			: h;
	return runHibernatingAlarms(next, until, calls);
}

const rawLines = (h: Harness): string[] =>
	h.blobs.keys("raw/").flatMap((key) => h.blobs.text(key).trim().split("\n"));

const subwayCalls = (h: Harness) =>
	h.calls.filter((call) => ALL_URL.test(call.url));
const busCalls = (h: Harness, routeId?: string) =>
	h.calls.filter((call) => {
		const route = routeOf(call.url);
		return route !== null && (routeId === undefined || route === routeId);
	});

async function usedToday(h: Harness, name: "subway" | "bus"): Promise<number> {
	const status = await h.core.status();
	return status.sources.find((s) => s.name === name)?.usedToday ?? -1;
}

describe("CollectorCore", () => {
	it("polls and stores within budget", async () => {
		const h = makeHarness();
		await runTicks(h, 45);
		expect(subwayCalls(h).length).toBeGreaterThanOrEqual(40);
		expect(subwayCalls(h).length).toBeLessThanOrEqual(45);
		expect(busCalls(h).length).toBeGreaterThanOrEqual(40);
		expect(busCalls(h).length).toBeLessThanOrEqual(45);
		const diff = Math.abs(
			busCalls(h, ROUTE_6411).length - busCalls(h, ROUTE_150).length
		);
		expect(diff).toBeLessThanOrEqual(1);
		expect(
			h.blobs.keys("raw/subway-all/2026/11/04/05-").length
		).toBeGreaterThan(0);
		expect(h.blobs.keys("events/subway/2026/11/04/05-").length).toBeGreaterThan(
			0
		);
		expect(h.blobs.keys(`raw/bus-${ROUTE_6411}/`).length).toBeGreaterThan(0);
		expect(h.blobs.keys("events/bus/").length).toBeGreaterThan(0);
		expect(await usedToday(h, "subway")).toBe(subwayCalls(h).length);
		const status = await h.core.status();
		expect(status.overall).toBe("ok");
		expect(
			status.lines.find((l) => l.key === "line2")?.vehicles
		).toBeGreaterThan(0);
		expect(h.sent).toEqual([]);
	});

	it("survives a restart", async () => {
		const first = makeHarness();
		await runTicks(first, 23);
		const subwayBefore = await usedToday(first, "subway");
		const busBefore = await usedToday(first, "bus");
		expect(subwayBefore).toBeGreaterThan(0);
		const eventKeysBefore = first.blobs.keys("events/").sort();
		const rawKeysBefore = new Set(first.blobs.keys("raw/"));
		expect(eventKeysBefore.length).toBeGreaterThan(0);

		const second = makeHarness({
			blobs: first.blobs,
			clock: first.clock,
			state: first.state,
		});
		expect(await usedToday(second, "subway")).toBe(subwayBefore);
		expect(await usedToday(second, "bus")).toBe(busBefore);
		await runTicks(second, 8);
		expect(await usedToday(second, "subway")).toBe(
			subwayBefore + subwayCalls(second).length
		);
		expect(subwayCalls(second).length).toBeGreaterThan(0);
		// 같은 표본 응답 → 새 관측 이벤트 0.
		expect(second.blobs.keys("events/").sort()).toEqual(eventKeysBefore);
		const rawAfter = second.blobs
			.keys("raw/")
			.filter((key) => !rawKeysBefore.has(key));
		expect(rawAfter.length).toBeGreaterThan(0);
		// 원본은 재시작 뒤 스트림마다 첫 줄만 본문을 남기고(버퍼와 함께 잃었을 수 있으므로) 나머지는 해시만.
		const records = rawAfter
			.flatMap((key) => second.blobs.text(key).trim().split("\n"))
			.map(
				(line) =>
					JSON.parse(line) as {
						body?: string;
						bodyHash: string;
						fetchedAt: number;
						source: string;
					}
			)
			.sort((a, b) => a.fetchedAt - b.fetchedAt);
		const seen = new Set<string>();
		for (const record of records) {
			expect(record.bodyHash).toHaveLength(64);
			if (seen.has(record.source)) {
				expect(record.body).toBeUndefined();
			} else {
				expect(typeof record.body).toBe("string");
				seen.add(record.source);
			}
		}
		expect(seen.size).toBeGreaterThanOrEqual(2);
		// 조각 번호가 이어져 같은 키를 덮어쓰지 않는다.
		expect(new Set(second.blobs.puts).size).toBe(second.blobs.puts.length);
	});

	it("never leaks keys", async () => {
		const keys: CollectorKeys = { bus: "q/r+s=", subway: "a/b+c=" };
		const secrets = [
			keys.subway,
			keys.bus,
			encodeURIComponent(keys.subway),
			encodeURIComponent(keys.bus),
			keys.subway.replaceAll("/", "\\/"),
			keys.bus.replaceAll("/", "\\/"),
		];
		let subwayAttempts = 0;
		const h = makeHarness({
			keys,
			respond: (url) => {
				if (ALL_URL.test(url)) {
					subwayAttempts += 1;
					if (subwayAttempts % 2 === 0) {
						// JSON 본문 안의 키는 `/`가 `\/`로 이스케이프돼 올 수 있다.
						return {
							body: JSON.stringify({
								message: `key=${keys.subway}`,
							}).replaceAll("/", "\\/"),
							status: 500,
						};
					}
					return {
						body: "",
						error: `connect ECONNREFUSED ${url}`,
						status: null,
					};
				}
				if (routeOf(url) === ROUTE_6411) {
					throw new Error(`fetch failed for ${url}`);
				}
				return {
					body: `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>${keys.bus} ${encodeURIComponent(keys.bus)} ${url}</returnAuthMsg><returnReasonCode>99</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`,
					status: 500,
				};
			},
		});
		await runTicks(h, 8);
		// 운행 끝까지 가지 않아도 5분이 지나 이력이 R2에 써졌다.
		expect(h.blobs.keys("raw/subway-all/").length).toBeGreaterThan(0);
		expect(h.blobs.keys(`raw/bus-${ROUTE_150}/`).length).toBeGreaterThan(0);
		expect(h.logs.length).toBeGreaterThan(0);
		const recorded = [
			...h.logs,
			...[...h.blobs.objects.keys()].map(
				(key) => `${key}\n${h.blobs.text(key)}`
			),
			JSON.stringify(await h.core.status()),
			(await h.core.snapshot("subway")).body,
			(await h.core.snapshot("bus")).body,
			...h.state.kv.values(),
			...h.state.metrics.values(),
		];
		expect(recorded.join("\n")).toContain("<key>");
		for (const text of recorded) {
			for (const secret of secrets) {
				expect(text.includes(secret)).toBe(false);
			}
		}
		// 줄을 풀어 낸 필드 값(본문·오류·요청)에도 어떤 형태의 키도 없다.
		const rawFields = h.blobs
			.keys("raw/")
			.flatMap((key) => h.blobs.text(key).trim().split("\n"))
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.flatMap((record) => [record.body, record.error, record.request])
			.filter((value): value is string => typeof value === "string");
		expect(rawFields.some((value) => value.includes("key=<key>"))).toBe(true);
		for (const value of rawFields) {
			for (const secret of secrets) {
				expect(value.includes(secret)).toBe(false);
			}
		}
	});

	it("retries failures with backoff and counts every attempt", async () => {
		const h = makeHarness({
			respond: (url) =>
				ALL_URL.test(url)
					? { body: "", error: "timeout", status: null }
					: fixtureResponder(url),
		});
		await h.core.tick();
		const attempts = subwayCalls(h);
		expect(attempts).toHaveLength(3);
		expect((attempts[1]?.at ?? 0) - (attempts[0]?.at ?? 0)).toBe(SECOND);
		expect((attempts[2]?.at ?? 0) - (attempts[1]?.at ?? 0)).toBe(2 * SECOND);
		expect(await usedToday(h, "subway")).toBe(3);
		const status = await h.core.status();
		expect(
			status.sources.find((s) => s.name === "subway")?.errorsToday
		).toEqual({ network: 3 });
	});

	it("stops a source after 401 and alerts once", async () => {
		const h = makeHarness({
			respond: (url) =>
				ALL_URL.test(url)
					? { body: "Unauthorized", status: 401 }
					: fixtureResponder(url),
		});
		await runTicks(h, 45);
		expect(subwayCalls(h)).toHaveLength(1);
		expect(busCalls(h).length).toBeGreaterThan(40);
		expect(h.sent).toEqual([
			{ body: "지하철 API가 401을 돌려줬습니다.", title: "Betro 키 오류" },
		]);
		// 그날 지하철은 멈춤 판단에서도 빠진다(cron 감시 포함).
		await runTicks(h, 23);
		await h.core.healthCheck();
		expect(subwayCalls(h)).toHaveLength(1);
		expect(h.sent).toHaveLength(1);

		// 다음 KST 날(00:00, 아직 운행 중)에는 다시 시도한다.
		h.clock.now = NEXT_KST_DAY;
		await h.core.tick();
		expect(subwayCalls(h)).toHaveLength(2);
		expect(h.sent.map((a) => a.title)).toEqual([
			"Betro 키 오류",
			"Betro 키 오류",
		]);
	});

	it("writes the daily report at the end of the operating day", async () => {
		const h = makeHarness({ start: NEAR_END });
		const lastAlarm = await runAlarms(h, OPERATING_END + 10 * MINUTE);
		expect(lastAlarm).toBe(NEXT_START);
		expect(h.blobs.keys("reports/")).toEqual(["reports/2026-11-04.json"]);
		const report = JSON.parse(h.blobs.text("reports/2026-11-04.json")) as {
			calls: Record<string, number>;
			history: HistorySummary | null;
			ok: boolean;
			operatingDate: string;
		};
		expect(report.operatingDate).toBe("2026-11-04");
		expect(report.calls.subway).toBe(subwayCalls(h).length);
		// 버퍼에 넣은 줄이 모두 R2에 쓰였다.
		expect(report.history?.raw.subway).toEqual({
			buffered: subwayCalls(h).length,
			written: subwayCalls(h).length,
		});
		expect(report.history?.raw.bus.written).toBe(busCalls(h).length);
		expect(report.history?.events.subway.buffered).toBeGreaterThan(0);
		expect(report.history?.events.subway.written).toBe(
			report.history?.events.subway.buffered
		);
		// 운행 끝에 남은 이력을 모두 비웠다.
		expect(h.blobs.keys("events/subway/2026/11/05/00-").length).toBeGreaterThan(
			0
		);
		h.clock.now = NEXT_START;
		await h.core.tick();
		expect(h.blobs.keys("reports/")).toEqual(["reports/2026-11-04.json"]);
	});

	it("rests a bus route after service-ended", async () => {
		const ended = new Set([ROUTE_6411]);
		const h = makeHarness({
			respond: (url) => {
				const route = routeOf(url);
				return route !== null && ended.has(route)
					? ok(SERVICE_ENDED_BODY)
					: fixtureResponder(url);
			},
		});
		await runTicks(h, 45);
		const rested = busCalls(h, ROUTE_6411).map((call) => call.at);
		expect(rested.length).toBeGreaterThanOrEqual(5);
		for (const [i, at] of rested.slice(1).entries()) {
			expect(at - (rested[i] ?? 0)).toBeGreaterThanOrEqual(
				SERVICE_ENDED_RECHECK_MS
			);
		}
		expect(busCalls(h, ROUTE_150).length).toBeGreaterThanOrEqual(20);

		// 두 노선 모두 운행 종료여도 멈춤 알림은 없다.
		ended.add(ROUTE_150);
		const before = busCalls(h).length;
		await runTicks(h, 90);
		const both = busCalls(h).slice(before);
		expect(both.length).toBeGreaterThan(0);
		expect(both.length).toBeLessThanOrEqual(2 * 13);
		await h.core.healthCheck();
		expect(h.sent).toEqual([]);
		const status = await h.core.status();
		expect(status.sources.find((s) => s.name === "bus")?.health).not.toBe(
			"stalled"
		);
	});

	it("never calls upstream beyond the daily budget, retries included", async () => {
		const h = makeHarness({
			config: prodConfig({ DAILY_BUDGET_SUBWAY: "10" }, []),
			respond: () => ({ body: "", error: "timeout", status: null }),
		});
		await h.core.tick();
		expect(h.calls.length).toBeGreaterThan(0);
		expect(h.calls.length).toBeLessThanOrEqual(10);
		expect(await usedToday(h, "subway")).toBe(h.calls.length);
	});

	it("still alerts a stalled source stopped by quota exhaustion", async () => {
		const h = makeHarness({
			respond: (url) =>
				routeOf(url) === null
					? fixtureResponder(url)
					: { body: "Too Many Requests", status: 429 },
		});
		await runTicks(h, 20);
		expect(busCalls(h)).toHaveLength(1);
		expect(h.sent).toEqual([
			{ body: "버스 수집이 15분 넘게 멈췄습니다.", title: "Betro 수집 멈춤" },
		]);
	});

	it("forgets resting routes from an earlier operating day", async () => {
		let busMode: "ended" | "down" = "ended";
		const h = makeHarness({
			respond: (url) => {
				if (routeOf(url) === null) {
					return fixtureResponder(url);
				}
				return busMode === "ended"
					? ok(SERVICE_ENDED_BODY)
					: { body: "", error: "timeout", status: null };
			},
			start: NEAR_END - 10 * MINUTE,
		});
		await runAlarms(h, OPERATING_END + MINUTE);
		expect(busCalls(h, ROUTE_6411).length).toBeGreaterThan(0);
		expect(busCalls(h, ROUTE_150).length).toBeGreaterThan(0);
		expect(h.sent).toEqual([]);

		// 다음 운행일에는 응답을 하나도 못 받아도 지난밤의 운행 종료로 알림을 막지 않는다.
		busMode = "down";
		h.clock.now = NEXT_START;
		await runTicks(h, 20);
		expect(h.sent).toEqual([
			{ body: "버스 수집이 15분 넘게 멈췄습니다.", title: "Betro 수집 멈춤" },
		]);
	});

	it("writes a report for every operating day missed while asleep", async () => {
		const h = makeHarness();
		await h.core.tick();
		expect(h.blobs.keys("reports/")).toEqual([]);
		h.clock.now = T0 + 3 * DAY + 10 * MINUTE;
		await h.core.tick();
		expect(h.blobs.keys("reports/").sort()).toEqual([
			"reports/2026-11-04.json",
			"reports/2026-11-05.json",
			"reports/2026-11-06.json",
		]);
	});

	it("reloads references only when batch ids change", async () => {
		const h = makeHarness();
		await h.core.tick();
		expect(h.loads).toEqual({ bus: 1, subway: 1 });
		expect(await h.core.refreshReferences()).toBe(false);
		h.batchIds.bus_route = 3;
		await runTicks(h, 5);
		expect(h.loads).toEqual({ bus: 2, subway: 1 });
		h.batchIds.timetable = 10;
		expect(await h.core.refreshReferences()).toBe(true);
		expect(h.loads).toEqual({ bus: 2, subway: 2 });
	});

	it("keeps the snapshot etag until the state changes", async () => {
		const h = makeHarness();
		await h.core.tick();
		const first = await h.core.snapshot("subway");
		h.clock.now += 10 * SECOND;
		const again = await h.core.snapshot("subway");
		expect(again).toEqual(first);
		expect(JSON.parse(first.body).vehicles.length).toBeGreaterThan(0);
		h.clock.now += STEP;
		await h.core.tick();
		const next = await h.core.snapshot("subway");
		expect(next.etag).not.toBe(first.etag);
		expect(next.etag).toHaveLength(16);
	});

	// 상류 장애(5xx·네트워크)는 멈춤이 아니지만 실시간이 끊긴다. 앱이 3분 넘게 끊긴 것을 보고
	// 시간표 추정 모드로 바꾸도록 staleSince를 남긴다(14).
	it("서울 지하철이 4분 동안 500을 돌려주면 staleSince가 남고, 200을 받으면 지워진다", async () => {
		const outage: { on: boolean } = { on: false };
		const h = makeHarness({
			respond: (url) =>
				outage.on && ALL_URL.test(url)
					? { body: "Internal Server Error", status: 500 }
					: fixtureResponder(url),
		});
		await h.core.tick();
		const subway = async () =>
			JSON.parse((await h.core.snapshot("subway")).body) as {
				staleSince: number | null;
				stoppedToday: boolean;
			};
		expect((await subway()).staleSince).toBeNull();
		outage.on = true;
		h.clock.now += STEP;
		const outageStart = h.clock.now;
		await runTicks(h, 3);
		const during = await subway();
		expect(during.stoppedToday).toBe(false);
		expect(during.staleSince).not.toBeNull();
		expect(during.staleSince ?? 0).toBeGreaterThanOrEqual(outageStart);
		expect(h.clock.now - (during.staleSince ?? 0)).toBeGreaterThan(3 * MINUTE);
		outage.on = false;
		const before = subwayCalls(h).length;
		await h.core.tick();
		expect(subwayCalls(h).length).toBeGreaterThan(before);
		expect((await subway()).staleSince).toBeNull();
	});

	// `dev` 버스는 노선마다 160초 간격이라 첫 실패 호출이 장애 시작보다 늦다. 그 호출부터 3분을 넘긴다.
	it("서울 버스 노선 하나가 6분 동안 500을 돌려주면 그 노선만 staleRoutes에 남고, 200을 받으면 지워진다", async () => {
		const outage: { on: boolean } = { on: false };
		const h = makeHarness({
			respond: (url) =>
				outage.on && routeOf(url) === ROUTE_6411
					? { body: "Internal Server Error", status: 500 }
					: fixtureResponder(url),
		});
		await h.core.tick();
		const bus = async () =>
			JSON.parse((await h.core.snapshot("bus")).body) as {
				staleRoutes: Record<string, number | undefined>;
				stoppedToday: boolean;
			};
		expect((await bus()).staleRoutes).toEqual({});
		outage.on = true;
		h.clock.now += STEP;
		const before = busCalls(h, ROUTE_6411).length;
		await runTicks(h, 5);
		const firstFailedAt = busCalls(h, ROUTE_6411)[before]?.at ?? 0;
		expect(firstFailedAt).toBeGreaterThan(0);
		const during = await bus();
		expect(during.stoppedToday).toBe(false);
		expect(Object.keys(during.staleRoutes)).toEqual([ROUTE_6411]);
		const staleAt = during.staleRoutes[ROUTE_6411] ?? 0;
		expect(staleAt).toBeGreaterThanOrEqual(firstFailedAt);
		expect(h.clock.now - staleAt).toBeGreaterThan(3 * MINUTE);
		outage.on = false;
		const failed = busCalls(h, ROUTE_6411).length;
		h.clock.now += STEP;
		await h.core.tick();
		expect(busCalls(h, ROUTE_6411).length).toBeGreaterThan(failed);
		expect((await bus()).staleRoutes).toEqual({});
	});

	// 서울 지하철 API에는 일일 한도 초과 코드가 없어(데이터 출처 조사) 상류가 멈추는 길은 인증 실패뿐이다.
	// 한도는 우리 예산 소진으로 센다(아래 테스트).
	it("서울 지하철이 인증 실패로 멈추면 지하철 스냅샷의 stoppedToday가 true이고 ETag가 바뀐다", async () => {
		const h = makeHarness({
			respond: (url) =>
				ALL_URL.test(url)
					? { body: "Unauthorized", status: 401 }
					: fixtureResponder(url),
		});
		// 멈추기 전 스냅샷을 먼저 읽어 캐시가 무효화되는지 본다.
		const before = await h.core.snapshot("subway");
		expect(JSON.parse(before.body).stoppedToday).toBe(false);
		await h.core.tick();
		expect(subwayCalls(h)).toHaveLength(1);
		const after = await h.core.snapshot("subway");
		expect(JSON.parse(after.body).stoppedToday).toBe(true);
		expect(after.etag).not.toBe(before.etag);
		// 버스는 멈추지 않았다.
		expect(JSON.parse((await h.core.snapshot("bus")).body).stoppedToday).toBe(
			false
		);
	});

	it("다음 날(KST)에는 stoppedToday가 false로 돌아온다", async () => {
		const h = makeHarness({
			respond: (url) =>
				ALL_URL.test(url)
					? { body: "Unauthorized", status: 401 }
					: fixtureResponder(url),
		});
		await h.core.tick();
		const stopped = await h.core.snapshot("subway");
		expect(JSON.parse(stopped.body).stoppedToday).toBe(true);
		h.clock.now = NEXT_KST_DAY;
		const nextDay = await h.core.snapshot("subway");
		expect(JSON.parse(nextDay.body).stoppedToday).toBe(false);
		expect(nextDay.etag).not.toBe(stopped.etag);
	});

	it("지하철 하루 예산을 다 쓰면 상류 오류가 없어도 stoppedToday가 true다", async () => {
		const h = makeHarness({ config: devConfig({ DAILY_BUDGET_SUBWAY: "1" }) });
		expect(
			JSON.parse((await h.core.snapshot("subway")).body).stoppedToday
		).toBe(false);
		await h.core.tick();
		expect(subwayCalls(h)).toHaveLength(1);
		expect(h.logs.some((line) => line.includes("stopped for the day"))).toBe(
			false
		);
		const body = JSON.parse((await h.core.snapshot("subway")).body);
		expect(body.stoppedToday).toBe(true);
		expect(body.vehicles.length).toBeGreaterThan(0);
	});

	// 지하철·버스 예산이 모두 바닥나면 alarm이 다음 KST 날까지 잔다. 그동안 tick이 없어도 TTL이 지난
	// 열차는 스냅샷에서 빠져야 앱이 시간표 열차를 그린다(스펙 5.8).
	it("예산이 바닥나 tick이 없어도 TTL이 지난 열차는 지하철 스냅샷에서 빠진다", async () => {
		const h = makeHarness({
			config: devConfig({ DAILY_BUDGET_BUS: "2", DAILY_BUDGET_SUBWAY: "1" }),
		});
		const { nextAlarmAt } = await h.core.tick();
		expect(nextAlarmAt).toBeGreaterThan(h.clock.now + SUBWAY_TTL_MS);
		const stopped = JSON.parse((await h.core.snapshot("subway")).body);
		expect(stopped.stoppedToday).toBe(true);
		expect(stopped.vehicles.length).toBeGreaterThan(0);
		h.clock.now += SUBWAY_TTL_MS + SECOND;
		const later = JSON.parse((await h.core.snapshot("subway")).body);
		expect(later.stoppedToday).toBe(true);
		expect(later.vehicles).toEqual([]);
		expect(later.generatedAt).toBe(h.clock.now);
	});

	it("TTL이 지난 뒤 DO가 다시 깨어나도(새 CollectorCore) 지하철 스냅샷에 옛 열차가 없다", async () => {
		const config = devConfig({
			DAILY_BUDGET_BUS: "2",
			DAILY_BUDGET_SUBWAY: "1",
		});
		const h = makeHarness({ config });
		await h.core.tick();
		h.clock.now += SUBWAY_TTL_MS + SECOND;
		const woken = makeHarness({
			blobs: h.blobs,
			clock: h.clock,
			config,
			state: h.state,
		});
		const body = JSON.parse((await woken.core.snapshot("subway")).body);
		expect(body.stoppedToday).toBe(true);
		expect(body.vehicles).toEqual([]);
	});

	it("버스가 계속 돌면 지하철 예산이 바닥나도 tick마다 TTL이 지난 열차를 뺀다", async () => {
		const h = makeHarness({ config: devConfig({ DAILY_BUDGET_SUBWAY: "1" }) });
		await runTicks(h, Math.ceil(SUBWAY_TTL_MS / STEP) + 1);
		const body = JSON.parse((await h.core.snapshot("subway")).body);
		expect(body.stoppedToday).toBe(true);
		expect(body.vehicles).toEqual([]);
	});

	it("counts every call when concurrent prod calls straddle a 5-minute bucket", async () => {
		const clock = { now: T0 + 4 * MINUTE + 58 * SECOND };
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let fetches = 0;
		const h = makeHarness({
			clock,
			// 넉넉한 예산: 몇십 초 뒤 다시 부를 수 있어 같은 버킷에서 재시작을 확인한다.
			config: prodConfig(
				{ DAILY_BUDGET_BUS: "100000", DAILY_BUDGET_SUBWAY: "100000" },
				[ROUTE_6411, ROUTE_150]
			),
			respond: async (url) => {
				fetches += 1;
				if (fetches === 1) {
					// 이전 버킷(05:00)에 시작한 첫 호출이 다음 버킷 호출들보다 늦게 끝난다.
					await gate;
					return fixtureResponder(url);
				}
				clock.now += SECOND;
				if (fetches === 8) {
					release();
				}
				return fixtureResponder(url);
			},
		});
		const { nextAlarmAt } = await h.core.tick();
		const buckets = [...h.state.metrics.values()].map(
			(value) => JSON.parse(value) as MetricsBucket
		);
		const starts = new Set(buckets.map((bucket) => bucket.bucketStart));
		expect(starts.size).toBeGreaterThanOrEqual(2);
		const total = buckets.reduce((sum, bucket) => sum + bucket.calls, 0);
		expect(total).toBe(h.calls.length);
		const used = (await usedToday(h, "subway")) + (await usedToday(h, "bus"));
		expect(total).toBe(used);

		// 재시작 뒤에도 저장된 버킷에 이어서 센다.
		clock.now = Math.max(nextAlarmAt, clock.now + 1);
		expect(clock.now).toBeLessThan(T0 + 10 * MINUTE);
		const restarted = makeHarness({
			clock,
			config: h.ports.config,
			state: h.state,
		});
		await restarted.core.tick();
		expect(restarted.calls.length).toBeGreaterThan(0);
		const after = [...h.state.metrics.values()]
			.map((value) => JSON.parse(value) as MetricsBucket)
			.reduce((sum, bucket) => sum + bucket.calls, 0);
		expect(after).toBe(total + restarted.calls.length);
	});

	it("alerts a stalled bus source when service-ended routes keep failing", async () => {
		let busMode: "ended" | "down" = "ended";
		const h = makeHarness({
			respond: (url) => {
				if (routeOf(url) === null) {
					return fixtureResponder(url);
				}
				return busMode === "ended"
					? ok(SERVICE_ENDED_BODY)
					: { body: "", error: "timeout", status: null };
			},
		});
		await runTicks(h, 20);
		expect(h.sent).toEqual([]);
		busMode = "down";
		await runTicks(h, 30);
		expect(h.sent).toEqual([
			{ body: "버스 수집이 15분 넘게 멈췄습니다.", title: "Betro 수집 멈춤" },
		]);
	});

	it("saves part counters before writing history to R2", async () => {
		const h = makeHarness();
		const unsaved: string[] = [];
		h.blobs.beforePut = (key) => {
			const match = HISTORY_PART.exec(key);
			if (match === null) {
				return;
			}
			const core = JSON.parse(h.state.kv.get(STATE_KEYS.core) ?? "{}") as {
				parts?: Record<string, number>;
			};
			if ((core.parts?.[match[1] ?? ""] ?? 0) <= Number(match[2])) {
				unsaved.push(key);
			}
		};
		await runTicks(h, 8);
		expect(h.blobs.puts.length).toBeGreaterThan(0);
		expect(unsaved).toEqual([]);
	});

	it("retries unwritten history and reports soon after the operating day ends", async () => {
		const h = makeHarness({ start: OPERATING_END - 2 * MINUTE });
		h.blobs.failing = true;
		const lastAlarm = await runAlarms(h, OPERATING_END + 1);
		expect(lastAlarm).toBeLessThanOrEqual(OPERATING_END + BACKLOG_RETRY_MS);
		expect(h.blobs.objects.size).toBe(0);

		h.blobs.failing = false;
		h.clock.now = lastAlarm;
		const { nextAlarmAt } = await h.core.tick();
		expect(nextAlarmAt).toBe(NEXT_START);
		expect(h.blobs.keys("reports/")).toEqual(["reports/2026-11-04.json"]);
		expect(h.blobs.keys("raw/subway-all/").length).toBeGreaterThan(0);
		expect(h.blobs.keys("events/subway/").length).toBeGreaterThan(0);
	});

	it("flushes history before an idle gap when idleFlushMs is set", async () => {
		const buffered = makeHarness();
		await buffered.core.tick();
		expect(buffered.blobs.keys("raw/").length).toBe(0);

		const eager = makeHarness({ idleFlushMs: 60 * SECOND });
		const { nextAlarmAt } = await eager.core.tick();
		expect(nextAlarmAt - T0).toBeGreaterThanOrEqual(60 * SECOND);
		expect(eager.blobs.keys("raw/subway-all/").length).toBe(1);
		expect(eager.blobs.keys("events/subway/").length).toBe(1);

		const roomy = makeHarness({ idleFlushMs: 10 * MINUTE });
		await roomy.core.tick();
		expect(roomy.blobs.keys("raw/").length).toBe(0);
	});

	// 운영에서 본 문제(2026-11-09 20:02~23:00 KST): 지하철과 버스 호출 시각이 서로 어긋나
	// alarm 간격이 10~60초가 되면, tick마다 DO가 잠들어 그 사이의 이력 버퍼가 사라졌다.
	it("keeps every raw line when the object hibernates between out-of-phase ticks", async () => {
		const state = new MemoryState();
		await state.put(STATE_KEYS.schedule, {
			nextAt: {
				[`bus:${ROUTE_150}`]: T0 + 120 * SECOND,
				[`bus:${ROUTE_6411}`]: T0 + 40 * SECOND,
				subway: T0,
			},
		});
		const h = makeHarness({ idleFlushMs: DEFAULT_IDLE_FLUSH_MS, state });

		const calls = await runHibernatingAlarms(h, T0 + 10 * MINUTE);

		expect(calls.length).toBeGreaterThanOrEqual(14);
		expect(rawLines(h).length).toBe(calls.length);
	});

	// 이력이 사라져도 지표는 저장되므로, 보고서가 넣은 줄 수와 쓴 줄 수를 따로 세어 알려야 한다.
	it("reports history lines that never reached R2", async () => {
		const state = new MemoryState();
		await state.put(STATE_KEYS.schedule, {
			nextAt: {
				[`bus:${ROUTE_150}`]: NEAR_END + 120 * SECOND,
				[`bus:${ROUTE_6411}`]: NEAR_END + 40 * SECOND,
				subway: NEAR_END,
			},
		});
		// 예전 기준값(60초): 10~60초 쉬는 동안 버퍼를 쓰지 않아 잠들 때마다 잃는다.
		const h = makeHarness({
			idleFlushMs: 60 * SECOND,
			start: NEAR_END,
			state,
		});

		const calls = await runHibernatingAlarms(h, OPERATING_END + MINUTE);

		const report = JSON.parse(h.blobs.text("reports/2026-11-04.json")) as {
			history: HistorySummary | null;
			ok: boolean;
		};
		const subway = report.history?.raw.subway;
		expect(subway?.buffered).toBe(
			calls.filter((call) => ALL_URL.test(call.url)).length
		);
		expect(subway?.written).toBeLessThan(subway?.buffered ?? 0);
		expect(report.ok).toBe(false);
	});
});

describe("CollectorCore station boards", () => {
	const GANGNAM = "1002000222";
	/** 표본 ALL 응답에 행이 없는 역. */
	const NO_ROWS = "1002000999";
	const DOBONGSAN = "1007000745";
	/** 표본 강남역 행의 recptnDt "2026-11-03 13:03:59"(KST) */
	const GANGNAM_SOURCE_AT = Date.UTC(2026, 10, 3, 4, 3, 59);

	it("keeps the rows of watched stations from each ALL response", async () => {
		const h = makeHarness();
		await h.core.watchStations([GANGNAM, NO_ROWS], T0 + 10 * MINUTE);
		await h.core.tick();
		expect(subwayCalls(h).length).toBeGreaterThan(0);
		const boards = await h.core.stationRows([GANGNAM, DOBONGSAN]);
		expect(Object.keys(boards)).toEqual([GANGNAM]);
		expect(boards[GANGNAM]).toEqual({
			fetchedAt: T0,
			rows: [
				{
					arvlCd: "99",
					barvlSec: 260,
					direction: "down",
					ordkey: "01003성수0",
					sourceAt: GANGNAM_SOURCE_AT,
					trainNo: "2229",
				},
				{
					arvlCd: "99",
					barvlSec: 430,
					direction: "down",
					ordkey: "02004성수0",
					sourceAt: GANGNAM_SOURCE_AT,
					trainNo: "2231",
				},
				{
					arvlCd: "2",
					barvlSec: 10,
					direction: "up",
					ordkey: "11000성수0",
					sourceAt: GANGNAM_SOURCE_AT,
					trainNo: "2226",
				},
				{
					arvlCd: "99",
					barvlSec: 240,
					direction: "up",
					ordkey: "12004성수0",
					sourceAt: GANGNAM_SOURCE_AT,
					trainNo: "3228",
				},
			],
		});
		// 등록했지만 응답에 행이 없는 역은 빈 행으로 남는다(받았지만 열차가 없었다).
		expect(await h.core.stationRows([NO_ROWS])).toEqual({
			[NO_ROWS]: { fetchedAt: T0, rows: [] },
		});
	});

	it("keeps the rows across a restart", async () => {
		const first = makeHarness();
		await first.core.watchStations([GANGNAM], T0 + 10 * MINUTE);
		await first.core.tick();
		const before = await first.core.stationRows([GANGNAM]);
		expect(before).toHaveProperty([GANGNAM, "rows", "length"], 4);
		const second = makeHarness({ clock: first.clock, state: first.state });
		expect(await second.core.stationRows([GANGNAM])).toEqual(before);
	});

	it("forgets a station on the first tick after its watch expires", async () => {
		const h = makeHarness();
		await h.core.watchStations([GANGNAM], T0 + 5 * MINUTE);
		await h.core.tick();
		expect(Object.keys(await h.core.stationRows([GANGNAM]))).toEqual([GANGNAM]);
		h.clock.now = T0 + 6 * MINUTE;
		await h.core.tick();
		expect(await h.core.stationRows([GANGNAM])).toEqual({});
	});

	it("extends a watch instead of shortening it", async () => {
		const h = makeHarness();
		await h.core.watchStations([GANGNAM], T0 + 30 * MINUTE);
		await h.core.watchStations([GANGNAM], T0 + 5 * MINUTE);
		await h.core.tick();
		h.clock.now = T0 + 6 * MINUTE;
		await h.core.tick();
		expect(Object.keys(await h.core.stationRows([GANGNAM]))).toEqual([GANGNAM]);
	});

	it("rejects station ids that are not 10 digits", async () => {
		const h = makeHarness();
		await expect(
			h.core.watchStations(["9".repeat(200_000)], T0 + 10 * MINUTE)
		).rejects.toThrow();
		await expect(
			h.core.watchStations(["abc"], T0 + 10 * MINUTE)
		).rejects.toThrow();
		expect(h.state.kv.get(STATE_KEYS.boards) ?? "").not.toContain(
			"999999999999"
		);
	});

	it("caps how many stations it watches at once and still extends watched ones", async () => {
		const h = makeHarness();
		const ids = Array.from({ length: MAX_WATCHED_STATION_TOTAL + 5 }, (_, i) =>
			String(1_000_000_000 + i)
		);
		for (let start = 0; start < ids.length; start += 200) {
			// biome-ignore lint/performance/noAwaitInLoops: 수집기 RPC처럼 차례로 등록한다
			await h.core.watchStations(
				ids.slice(start, start + 200),
				T0 + 10 * MINUTE
			);
		}
		const stored = JSON.parse(h.state.kv.get(STATE_KEYS.boards) ?? "{}") as {
			watch: Record<string, number>;
		};
		expect(Object.keys(stored.watch)).toHaveLength(MAX_WATCHED_STATION_TOTAL);
		expect(stored.watch[ids.at(-1) ?? ""]).toBeUndefined();
		await h.core.watchStations([ids[0] ?? ""], T0 + 30 * MINUTE);
		const extended = JSON.parse(h.state.kv.get(STATE_KEYS.boards) ?? "{}") as {
			watch: Record<string, number>;
		};
		expect(extended.watch[ids[0] ?? ""]).toBe(T0 + 30 * MINUTE);
	});

	it("never stores key text with the station rows", async () => {
		const keys: CollectorKeys = { bus: "q/r+s=", subway: "a/b+c=" };
		const h = makeHarness({ keys });
		await h.core.watchStations([GANGNAM], T0 + 10 * MINUTE);
		await h.core.tick();
		const stored = h.state.kv.get(STATE_KEYS.boards) ?? "";
		expect(stored).toContain(GANGNAM);
		for (const secret of [keys.subway, keys.bus]) {
			expect(stored).not.toContain(secret);
			expect(stored).not.toContain(encodeURIComponent(secret));
		}
	});
});

describe("CollectorCore bus watches", () => {
	const A = "100100118";
	const B = "100100119";
	const C = "100100120";
	/** 지하철 없이 관측 요청 노선만 부르는 설정(호출마다 그 시각에 밀린 노선을 모두 부른다). */
	const watchOnly: CollectorConfig = {
		...prodConfig({}, []),
		subwayLines: [],
	};
	/** 표본에 없는 노선도 정상 응답(150 본문)을 준다. */
	const watchResponder: Responder = (url) =>
		ok(BUS_BODIES[routeOf(url) ?? ""] ?? JSON.stringify(bus150));

	const watchHarness = (config: CollectorConfig = watchOnly): Harness =>
		makeHarness({ config, respond: watchResponder });

	/** tick 한 번에 부른 버스 노선(정렬). */
	async function busRoutesOfTick(h: Harness): Promise<string[]> {
		h.calls.splice(0);
		await h.core.tick();
		return busCalls(h)
			.map((call) => routeOf(call.url) ?? "")
			.sort();
	}

	it("replaces an install's watch set and drops it after until", async () => {
		const h = watchHarness();
		await h.core.watchBusRoutes("install-1", [A, B], T0 + 5 * MINUTE);
		await h.core.watchBusRoutes("install-1", [B], T0 + 5 * MINUTE);
		await h.core.watchBusRoutes("install-2", [C], T0 + 5 * MINUTE);
		await h.core.watchBusRoutes("install-2", [], T0 + 5 * MINUTE);
		expect(await busRoutesOfTick(h)).toEqual([B]);
		h.clock.now = T0 + 6 * MINUTE;
		expect(await busRoutesOfTick(h)).toEqual([]);
		expect(h.state.kv.get(STATE_KEYS.busWatch)).toBe("{}");
	});

	it("keeps a route watched by another install when one install expires", async () => {
		const h = watchHarness();
		await h.core.watchBusRoutes("install-1", [A], T0 + 5 * MINUTE);
		await h.core.watchBusRoutes("install-2", [A], T0 + 20 * MINUTE);
		// 같은 노선을 둘이 봐도 한 번만 부른다.
		expect(await busRoutesOfTick(h)).toEqual([A]);
		h.clock.now = T0 + 6 * MINUTE;
		expect(await busRoutesOfTick(h)).toEqual([A]);
		h.clock.now = T0 + 21 * MINUTE;
		expect(await busRoutesOfTick(h)).toEqual([]);
	});

	it("caps the union at maxTotal, preferring later until", async () => {
		const h = watchHarness({ ...watchOnly, mapWatchMaxTotal: 2 });
		await h.core.watchBusRoutes("install-1", [A, B], T0 + 5 * MINUTE);
		await h.core.watchBusRoutes("install-2", [C], T0 + 10 * MINUTE);
		expect(await busRoutesOfTick(h)).toEqual([A, C]);
	});

	it("loads bus references for newly watched routes", async () => {
		const h = watchHarness(devConfig({}));
		await h.core.tick();
		expect(h.busLoads).toHaveLength(1);
		expect(h.busLoads[0]).not.toContain(A);
		await h.core.watchBusRoutes("install-1", [A], T0 + 10 * MINUTE);
		h.clock.now += STEP;
		await h.core.tick();
		expect(h.busLoads).toHaveLength(2);
		expect(h.busLoads[1]).toContain(A);
		// 요청 노선이 그대로면(하트비트) 다시 읽지 않는다.
		await h.core.watchBusRoutes("install-1", [A], T0 + 12 * MINUTE);
		h.clock.now += STEP;
		await h.core.tick();
		expect(h.busLoads).toHaveLength(2);
		// 다시 읽어도 표본 참조에 든 설정 노선(6411)은 남는다.
		expect(await h.core.refreshReferences()).toBe(false);
	});

	it("places a watched route's buses on its shape and reloads it after a lapse", async () => {
		const h = watchHarness({ ...devConfig({}), busRouteIds: [ROUTE_6411] });
		// 이 테스트의 D1은 요청한 노선만 돌려준다.
		h.ports.reference.loadBus = (routeIds) => {
			h.busLoads.push([...routeIds]);
			const all = busReference();
			return Promise.resolve({
				batchId: all.batchId,
				routes: new Map(
					[...all.routes].filter(([routeId]) => routeIds.includes(routeId))
				),
			});
		};
		await h.core.watchBusRoutes("install-1", [ROUTE_150], T0 + 5 * MINUTE);
		await h.core.tick();
		expect(busCalls(h, ROUTE_150)).toHaveLength(1);
		const vehicles = (
			JSON.parse((await h.core.snapshot("bus")).body) as {
				vehicles: { routeId: string; shapeDistanceM: number | null }[];
			}
		).vehicles.filter((vehicle) => vehicle.routeId === ROUTE_150);
		expect(vehicles.length).toBeGreaterThan(0);
		expect(vehicles.every((vehicle) => vehicle.shapeDistanceM !== null)).toBe(
			true
		);
		expect(h.logs.filter((line) => line.includes("failed"))).toEqual([]);

		// 요청이 풀리면 참조에서 빼고, 다시 요청하면 다시 읽는다.
		h.clock.now = T0 + 6 * MINUTE;
		await h.core.tick();
		const loadsBefore = h.busLoads.length;
		await h.core.watchBusRoutes("install-1", [ROUTE_150], T0 + 10 * MINUTE);
		h.clock.now += STEP;
		await h.core.tick();
		expect(h.busLoads.slice(loadsBefore)).toEqual([[ROUTE_150]]);
	});

	it("keeps watches across a restart", async () => {
		const first = watchHarness();
		await first.core.watchBusRoutes("install-1", [A], T0 + 10 * MINUTE);
		const second = makeHarness({
			clock: first.clock,
			config: watchOnly,
			respond: watchResponder,
			state: first.state,
		});
		expect(await busRoutesOfTick(second)).toEqual([A]);
	});

	it("rejects non-numeric route ids and more routes than one install may watch", async () => {
		const h = watchHarness();
		await expect(
			h.core.watchBusRoutes("install-1", ["seoul-bus:1"], T0 + MINUTE)
		).rejects.toThrow();
		const seven = ["1", "2", "3", "4", "5", "6", "7"];
		await expect(
			h.core.watchBusRoutes("install-1", seven, T0 + MINUTE)
		).rejects.toThrow();
		// 같은 노선을 두 번 보내도 한 노선으로 센다.
		await h.core.watchBusRoutes(
			"install-1",
			["1", "2", "3", "4", "5", "6", "6"],
			T0 + MINUTE
		);
		expect(await busRoutesOfTick(h)).toEqual(["1", "2", "3", "4", "5", "6"]);
	});
});

describe("CollectorCore regional bus watches", () => {
	const GBIS_6411 = "gbis:100100290";
	const TAGO_82 = "tago:ICB361000005";
	/** 지하철 없이 관측 요청 노선만 부르는 설정. */
	const watchOnly: CollectorConfig = { ...prodConfig({}, []), subwayLines: [] };

	/** 서울 표본 참조에 6411 모양을 빌린 지역 노선을 더한다. 요청한 노선만 돌려준다. */
	function regionalReference(
		routeIds: readonly string[],
		tagoCity: string | null
	): BusReference {
		const seoul = busReference();
		const shape = seoul.routes.get(ROUTE_6411) as BusRouteRef;
		const routes = new Map<string, BusRouteRef>(seoul.routes);
		routes.set(GBIS_6411, { ...shape, routeId: GBIS_6411 });
		routes.set(TAGO_82, {
			...shape,
			routeId: TAGO_82,
			...(tagoCity ? { cityCode: tagoCity } : {}),
		});
		return {
			batchId: seoul.batchId,
			routes: new Map(
				[...routes].filter(([routeId]) => routeIds.includes(routeId))
			),
		};
	}

	const regionalResponder =
		(overrides: { gbis?: UpstreamResponse; tago?: UpstreamResponse } = {}) =>
		(url: string): UpstreamResponse | Promise<UpstreamResponse> => {
			if (GBIS_URL.test(url)) {
				return (
					overrides.gbis ?? {
						body: gbisLocation.body,
						status: gbisLocation.status,
					}
				);
			}
			if (TAGO_URL.test(url)) {
				return (
					overrides.tago ?? {
						body: tagoLocation.body,
						status: tagoLocation.status,
					}
				);
			}
			return fixtureResponder(url);
		};

	function regionalHarness(
		options: {
			respond?: Responder;
			state?: MemoryState;
			clock?: { now: number };
			/** 기본은 `watchOnly`. */
			config?: CollectorConfig;
			/** 참조의 TAGO 도시 코드. 기본 "23"(인천), null이면 없다. */
			tagoCity?: string | null;
		} = {}
	): Harness {
		const h = makeHarness({
			clock: options.clock,
			config: options.config ?? watchOnly,
			respond: options.respond ?? regionalResponder(),
			state: options.state,
		});
		h.ports.reference.loadBus = (routeIds) => {
			h.busLoads.push([...routeIds]);
			return Promise.resolve(
				regionalReference(
					routeIds,
					options.tagoCity === undefined ? "23" : options.tagoCity
				)
			);
		};
		return h;
	}

	interface SnapshotBody {
		stoppedSources: string[];
		vehicles: { routeId: string; vehId: string; qualityFlags: string[] }[];
	}

	async function busSnapshot(h: Harness): Promise<SnapshotBody> {
		return JSON.parse((await h.core.snapshot("bus")).body) as SnapshotBody;
	}

	const callsTo = (h: Harness, pattern: RegExp) =>
		h.calls.filter((call) => pattern.test(call.url));

	it("gbis:100100290 감시는 서울 100100290과 다른 스케줄 키와 차량 키를 쓴다", async () => {
		const h = regionalHarness();
		await h.core.watchBusRoutes(
			"install-1",
			[ROUTE_6411, GBIS_6411],
			T0 + 10 * MINUTE
		);
		await h.core.tick();
		const seoul = callsTo(h, SEOUL_URL);
		const gbis = callsTo(h, GBIS_URL);
		expect(seoul).toHaveLength(1);
		expect(seoul[0]?.url).toContain("busRouteId=100100290");
		expect(gbis).toHaveLength(1);
		expect(gbis[0]?.url).toContain("routeId=100100290");
		const schedule = JSON.parse(
			h.state.kv.get(STATE_KEYS.schedule) ?? "{}"
		) as {
			nextAt: Record<string, number>;
		};
		expect(Object.keys(schedule.nextAt).sort()).toEqual([
			"bus:100100290",
			"bus:gbis:100100290",
		]);
		const { stoppedSources, vehicles } = await busSnapshot(h);
		expect(stoppedSources).toEqual([]);
		const routeIds = new Set(vehicles.map((vehicle) => vehicle.routeId));
		expect([...routeIds].sort()).toEqual([ROUTE_6411, GBIS_6411]);
		const regional = vehicles.find(
			(vehicle) =>
				vehicle.routeId === GBIS_6411 && vehicle.vehId === "200011171"
		);
		expect(regional?.qualityFlags).toEqual([
			"position-from-stop",
			"no-source-time",
		]);
		expect(h.logs.filter((line) => line.includes("failed"))).toEqual([]);
	});

	it("GBIS 한도 초과는 gbis-position만 멈추고 서울 버스는 다음 tick에도 부른다", async () => {
		const h = regionalHarness({
			respond: regionalResponder({ gbis: { body: "", status: 429 } }),
		});
		await h.core.watchBusRoutes(
			"install-1",
			[ROUTE_6411, GBIS_6411, TAGO_82],
			T0 + 30 * MINUTE
		);
		// 멈추기 전 스냅샷을 먼저 읽어 캐시가 무효화되는지 본다.
		expect((await busSnapshot(h)).stoppedSources).toEqual([]);
		await h.core.tick();
		expect(callsTo(h, GBIS_URL)).toHaveLength(1);
		expect((await busSnapshot(h)).stoppedSources).toEqual(["gbis"]);
		h.calls.splice(0);
		h.clock.now += 10 * MINUTE;
		await h.core.tick();
		expect(callsTo(h, GBIS_URL)).toHaveLength(0);
		expect(callsTo(h, SEOUL_URL)).toHaveLength(1);
		expect(callsTo(h, TAGO_URL)).toHaveLength(1);
		expect(callsTo(h, TAGO_URL)[0]?.url).toContain("cityCode=23");
		const budget = JSON.parse(h.state.kv.get(STATE_KEYS.budget) ?? "{}") as {
			used: Record<string, number>;
		};
		expect(budget.used).toMatchObject({ bus: 2, "gbis-position": 1 });
		expect(h.sent).toEqual([]);
		// 다음 KST 날에는 다시 부르고 멈춤 표시도 풀린다.
		h.clock.now = NEXT_KST_DAY;
		h.calls.splice(0);
		await h.core.watchBusRoutes(
			"install-1",
			[GBIS_6411],
			NEXT_KST_DAY + 10 * MINUTE
		);
		expect((await busSnapshot(h)).stoppedSources).toEqual([]);
		await h.core.tick();
		expect(callsTo(h, GBIS_URL)).toHaveLength(1);
	});

	it("GBIS 위치 예산을 다 쓰면 버스 스냅샷 stoppedSources에 gbis가 있다", async () => {
		const h = regionalHarness({
			config: {
				...prodConfig({ DAILY_BUDGET_GBIS_LOCATION_COLLECTOR: "1" }, []),
				subwayLines: [],
			},
		});
		await h.core.watchBusRoutes("install-1", [GBIS_6411], T0 + 30 * MINUTE);
		// 예산을 쓰기 전 스냅샷을 먼저 읽어 캐시가 무효화되는지 본다.
		expect((await busSnapshot(h)).stoppedSources).toEqual([]);
		await h.core.tick();
		expect(callsTo(h, GBIS_URL)).toHaveLength(1);
		expect(h.logs.some((line) => line.includes("stopped for the day"))).toBe(
			false
		);
		const body = (await busSnapshot(h)) as SnapshotBody & {
			stoppedToday: boolean;
		};
		expect(body.stoppedSources).toEqual(["gbis"]);
		// 서울 버스 예산은 남았다.
		expect(body.stoppedToday).toBe(false);
	});

	it("GBIS XML 게이트웨이 한도 초과(22)도 그날 GBIS를 멈춘다", async () => {
		const quota = {
			body: "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
			status: 200,
		};
		const h = regionalHarness({
			respond: regionalResponder({ gbis: quota }),
		});
		await h.core.watchBusRoutes("install-1", [GBIS_6411], T0 + 30 * MINUTE);
		await h.core.tick();
		expect(callsTo(h, GBIS_URL)).toHaveLength(1);
		expect((await busSnapshot(h)).stoppedSources).toEqual(["gbis"]);
		h.calls.splice(0);
		h.clock.now += 10 * MINUTE;
		await h.core.tick();
		expect(callsTo(h, GBIS_URL)).toHaveLength(0);
	});

	it("TAGO 게이트웨이 04는 한 번만 다시 부르고 출처를 멈추지 않는다", async () => {
		const gateway = { body: tagoGateway04.body, status: tagoGateway04.status };
		const h = regionalHarness({
			respond: regionalResponder({ tago: gateway }),
		});
		await h.core.watchBusRoutes("install-1", [TAGO_82], T0 + 30 * MINUTE);
		await h.core.tick();
		expect(callsTo(h, TAGO_URL)).toHaveLength(2);
		expect((await busSnapshot(h)).stoppedSources).toEqual([]);
		h.calls.splice(0);
		h.clock.now += 10 * MINUTE;
		await h.core.tick();
		expect(callsTo(h, TAGO_URL)).toHaveLength(2);
	});

	it("도시 코드를 모르는 TAGO 노선은 예산을 쓰지 않고 건너뛴다", async () => {
		const h = regionalHarness({ tagoCity: null });
		await h.core.watchBusRoutes("install-1", [TAGO_82], T0 + 30 * MINUTE);
		await h.core.tick();
		expect(callsTo(h, TAGO_URL)).toHaveLength(0);
		const budget = JSON.parse(h.state.kv.get(STATE_KEYS.budget) ?? "{}") as {
			used: Record<string, number>;
		};
		expect(budget.used["tago-position"]).toBe(0);
	});

	it("순번이 5분 넘게 그대로인 GBIS 차량은 재시작을 거쳐도 스냅샷에서 바로 빠진다", async () => {
		const first = regionalHarness();
		await first.core.watchBusRoutes("install-1", [GBIS_6411], T0 + 30 * MINUTE);
		await first.core.tick();
		const before = (await busSnapshot(first)).vehicles.filter(
			(vehicle) => vehicle.routeId === GBIS_6411
		);
		expect(before.length).toBeGreaterThan(0);
		// 4분 뒤(마지막으로 본 시각)에도 같은 순번이다. DO가 잠들었다 깨어난다.
		first.clock.now = T0 + 4 * MINUTE;
		await first.core.tick();
		const second = regionalHarness({ clock: first.clock, state: first.state });
		second.clock.now = T0 + 5 * MINUTE + 30 * SECOND;
		await second.core.tick();
		second.clock.now = T0 + 9 * MINUTE;
		await second.core.tick();
		expect(callsTo(second, GBIS_URL).length).toBeGreaterThan(0);
		// BUS_TTL(마지막으로 본 뒤 5분)이 지나기 전이지만 멈춘 차량은 남지 않는다.
		const after = (await busSnapshot(second)).vehicles.filter(
			(vehicle) => vehicle.routeId === GBIS_6411
		);
		expect(after).toEqual([]);
	});

	for (const [label, leaving] of [
		["빈 목록", [] as string[]],
		["다른 노선", [ROUTE_6411]],
	] as const) {
		it(`지도를 잠깐 떠나며 ${label}을 보내고 원래 TTL 안에 돌아오면 멈춘 GBIS 차량이 다시 나오지 않는다`, async () => {
			const first = regionalHarness();
			const TTL = 90 * SECOND;
			await first.core.watchBusRoutes("install-1", [GBIS_6411], T0 + TTL);
			await first.core.tick();
			// 하트비트로 감시를 늘리며 4분 동안 같은 순번을 본다.
			first.clock.now = T0 + 4 * MINUTE;
			await first.core.watchBusRoutes(
				"install-1",
				[GBIS_6411],
				first.clock.now + TTL
			);
			await first.core.tick();
			// 탭을 옮기거나 07을 열어 지도가 이 노선을 내려놓는다.
			first.clock.now = T0 + 4 * MINUTE + 10 * SECOND;
			await first.core.watchBusRoutes(
				"install-1",
				leaving,
				first.clock.now + TTL
			);
			// DO가 잠들었다 깨어나고, 보지 않는 동안에도 tick은 돈다.
			const second = regionalHarness({
				clock: first.clock,
				state: first.state,
			});
			second.clock.now = T0 + 4 * MINUTE + 30 * SECOND;
			await second.core.tick();
			// 원래 TTL(4분 + 90초) 안에 지도로 돌아오고, 다음 GBIS 호출 때까지 하트비트로 감시를 늘린다.
			second.calls.splice(0);
			for (const minute of [5, 6, 7]) {
				second.clock.now = T0 + minute * MINUTE;
				// biome-ignore lint/performance/noAwaitInLoops: 하트비트는 시각 순서대로 보낸다.
				await second.core.watchBusRoutes(
					"install-1",
					[GBIS_6411],
					second.clock.now + TTL
				);
			}
			second.clock.now = T0 + 8 * MINUTE;
			await second.core.tick();
			expect(callsTo(second, GBIS_URL).length).toBeGreaterThan(0);
			const after = (await busSnapshot(second)).vehicles.filter(
				(vehicle) => vehicle.routeId === GBIS_6411
			);
			expect(after).toEqual([]);
		});
	}

	it("하트비트 직전에 지도를 떠나도 떠난 때부터 TTL 동안은 멈춘 GBIS 차량이 다시 나오지 않는다", async () => {
		const h = regionalHarness();
		const TTL = 90 * SECOND;
		await h.core.watchBusRoutes("install-1", [GBIS_6411], T0 + TTL);
		await h.core.tick();
		h.clock.now = T0 + 4 * MINUTE;
		await h.core.watchBusRoutes("install-1", [GBIS_6411], h.clock.now + TTL);
		await h.core.tick();
		// 마지막 하트비트(4분)의 만료는 5분 30초다. 그 직전인 5분 20초에 떠난다.
		h.clock.now = T0 + 5 * MINUTE + 20 * SECOND;
		await h.core.watchBusRoutes("install-1", [], h.clock.now + TTL);
		// 앞 요청의 만료(5분 30초)는 지났지만 떠난 지 90초는 안 됐다.
		h.clock.now = T0 + 5 * MINUTE + 40 * SECOND;
		await h.core.tick();
		h.calls.splice(0);
		for (const second of [6 * 60 + 20, 7 * 60 + 20]) {
			h.clock.now = T0 + second * SECOND;
			// biome-ignore lint/performance/noAwaitInLoops: 하트비트는 시각 순서대로 보낸다.
			await h.core.watchBusRoutes("install-1", [GBIS_6411], h.clock.now + TTL);
		}
		h.clock.now = T0 + 8 * MINUTE;
		await h.core.tick();
		expect(callsTo(h, GBIS_URL).length).toBeGreaterThan(0);
		const after = (await busSnapshot(h)).vehicles.filter(
			(vehicle) => vehicle.routeId === GBIS_6411
		);
		expect(after).toEqual([]);
	});

	it("내려놓은 지역 노선의 멈춤 판단 기록은 원래 TTL이 지나면 지운다", async () => {
		const h = regionalHarness();
		await h.core.watchBusRoutes("install-1", [GBIS_6411], T0 + 90 * SECOND);
		await h.core.tick();
		await h.core.watchBusRoutes("install-1", [], T0 + 90 * SECOND);
		const savedCore = () =>
			JSON.parse(h.state.kv.get(STATE_KEYS.core) ?? "{}") as {
				regionalPrev?: Record<string, unknown>;
				regionalPrevKeepUntil?: Record<string, number>;
			};
		h.clock.now = T0 + 60 * SECOND;
		await h.core.tick();
		expect(Object.keys(savedCore().regionalPrev ?? {})).toEqual([GBIS_6411]);
		h.clock.now = T0 + 91 * SECOND;
		await h.core.tick();
		expect(savedCore().regionalPrev ?? {}).toEqual({});
		expect(savedCore().regionalPrevKeepUntil ?? {}).toEqual({});
	});

	it("숫자가 아닌 tago 키도 감시를 받는다", async () => {
		const h = regionalHarness();
		await h.core.watchBusRoutes("install-1", [TAGO_82], T0 + MINUTE);
		const rejected = await Promise.allSettled(
			["gbis:abc", "tago:icb1", "kakao:1", "tago:ICB1/x"].map((bad) =>
				h.core.watchBusRoutes("install-1", [bad], T0 + MINUTE)
			)
		);
		expect(rejected.map((result) => result.status)).toEqual([
			"rejected",
			"rejected",
			"rejected",
			"rejected",
		]);
	});
});

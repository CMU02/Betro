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
import { describe, expect, it } from "bun:test";
import { gunzipSync } from "node:zlib";
import arrivalSample from "../../../../packages/realtime/src/__fixtures__/arrival-all-sample.json";
import bus150 from "../../../../packages/realtime/src/__fixtures__/bus-150.json";
import bus6411 from "../../../../packages/realtime/src/__fixtures__/bus-6411.json";
import busReferenceFixture from "../../../../packages/realtime/src/__fixtures__/bus-reference-6411-150.json";
import subwayReferenceFixture from "../../../../packages/realtime/src/__fixtures__/subway-reference-sample.json";
import { SERVICE_ENDED_RECHECK_MS } from "./apply-call";
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
			loadBus: () => {
				loads.bus += 1;
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

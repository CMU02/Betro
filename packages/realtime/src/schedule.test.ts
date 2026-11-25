import { LINES } from "@Betro/transit-static/lines";
import { describe, expect, it } from "bun:test";
import { type BudgetState, consume, emptyBudget } from "./budget";
import {
	type CallPlan,
	devConfig,
	interval,
	planTick,
	prodConfig,
	remainingOperatingMs,
	type ScheduleState,
	takeToken,
} from "./schedule";
import { kstToEpochMs } from "./time";

const at = (s: string): number => kstToEpochMs(s);
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const dev = devConfig({});

const budgetKind = (plan: CallPlan): "subway" | "bus" =>
	plan.kind === "bus" ? "bus" : "subway";

describe("config", () => {
	it("dev defaults", () => {
		expect(dev).toEqual({
			busMinIntervalMs: 160_000,
			busRouteIds: ["100100290", "100100029"],
			dailyBudget: { bus: 900, subway: 900 },
			mapWatchMaxPerInstall: 6,
			mapWatchMaxTotal: 40,
			mode: "dev",
			operatingEnd: "01:00",
			operatingStart: "05:00",
			subwayLines: [],
			subwayMinIntervalMs: 80_000,
		});
	});

	it("reads overrides from env", () => {
		const config = devConfig({
			DAILY_BUDGET_BUS: "400",
			DAILY_BUDGET_SUBWAY: "500",
			MAP_WATCH_MAX_PER_INSTALL: "3",
			MAP_WATCH_MAX_TOTAL: "10",
			OPERATING_END_KST: "00:30",
			OPERATING_START_KST: "06:00",
		});
		expect(config.operatingStart).toBe("06:00");
		expect(config.operatingEnd).toBe("00:30");
		expect(config.dailyBudget).toEqual({ bus: 400, subway: 500 });
		expect(config.mapWatchMaxPerInstall).toBe(3);
		expect(config.mapWatchMaxTotal).toBe(10);
		expect(() => devConfig({ DAILY_BUDGET_BUS: "lots" })).toThrow();
		expect(() => devConfig({ OPERATING_START_KST: "5am" })).toThrow();
	});

	it("prod polls every line position api and the given routes", () => {
		const config = prodConfig({}, ["r1", "r2", "r3"]);
		expect(config.mode).toBe("prod");
		expect(config.subwayLines).toEqual(LINES.map((line) => line.nameKo));
		expect(config.subwayLines).toHaveLength(19);
		expect(config.busRouteIds).toEqual(["r1", "r2", "r3"]);
		expect(config.subwayMinIntervalMs).toBe(20_000);
		expect(config.busMinIntervalMs).toBe(30_000);
		expect(config.busRequestsPerSecond).toBe(10);
	});
});

describe("schedule", () => {
	it("counts the operating time left in the kst day", () => {
		expect(remainingOperatingMs(at("2026-11-04 05:00:00"), dev)).toBe(
			19 * HOUR_MS
		);
		expect(remainingOperatingMs(at("2026-11-04 00:00:00"), dev)).toBe(
			20 * HOUR_MS
		);
		expect(remainingOperatingMs(at("2026-11-04 00:30:00"), dev)).toBe(
			19.5 * HOUR_MS
		);
		expect(remainingOperatingMs(at("2026-11-04 03:00:00"), dev)).toBe(
			19 * HOUR_MS
		);
		expect(remainingOperatingMs(at("2026-11-04 23:30:00"), dev)).toBe(
			30 * MINUTE_MS
		);
	});

	it("dev budget spreads over the operating day", () => {
		const now = at("2026-11-04 05:00:00");
		const budget = emptyBudget(now);
		expect(interval("subway", now, budget, dev)).toBe(80_000);
		expect(interval("bus", now, budget, dev)).toBe(160_000);
	});

	it("stretches when budget runs short", () => {
		const now = at("2026-11-04 12:00:00");
		const budget = consume(emptyBudget(now), "subway", now, 800);
		expect(interval("subway", now, budget, dev)).toBe(
			remainingOperatingMs(now, dev) / 100
		);
		expect(interval("subway", now, budget, dev)).toBe(432_000);
	});

	it("budget resets at kst midnight but polling continues until 1am", () => {
		const late = at("2026-11-04 23:59:00");
		const budget: BudgetState = {
			kstDay: "2026-11-04",
			used: { bus: 900, subway: 900 },
		};
		const schedule: ScheduleState = {
			nextAt: {
				"bus:100100029": late - 1000,
				"bus:100100290": late - 1000,
				subway: late - 1000,
			},
		};
		const first = planTick(late, schedule, budget, dev);
		expect(first.due).toEqual([]);
		expect(first.nextAlarmAt).toBe(at("2026-11-05 00:00:00"));

		const after = at("2026-11-05 00:01:00");
		const second = planTick(after, first.schedule, budget, dev);
		expect(second.due).toContainEqual({ kind: "subway-all" });
		expect(consume(budget, "subway", after).used.subway).toBe(1);
	});

	it("sleeps until 5am outside operating hours", () => {
		const now = at("2026-11-05 01:30:00");
		const plan = planTick(now, { nextAt: {} }, emptyBudget(now), dev);
		expect(plan.due).toEqual([]);
		expect(plan.nextAlarmAt).toBe(at("2026-11-05 05:00:00"));
	});

	it("alternates the two dev bus routes", () => {
		const start = at("2026-11-04 05:00:00");
		const end = start + HOUR_MS;
		let now = start;
		let schedule: ScheduleState = { nextAt: {} };
		let budget = emptyBudget(now);
		const calls = new Map<string, number>();
		while (now < end) {
			const plan = planTick(now, schedule, budget, dev);
			for (const call of plan.due) {
				const key = call.kind === "bus" ? call.routeId : call.kind;
				calls.set(key, (calls.get(key) ?? 0) + 1);
				budget = consume(budget, budgetKind(call), now);
			}
			expect(plan.due.filter((call) => call.kind === "bus").length).toBe(
				plan.due.some((call) => call.kind === "bus") ? 1 : 0
			);
			expect(plan.nextAlarmAt).toBeGreaterThanOrEqual(now + 5000);
			({ schedule, nextAlarmAt: now } = plan);
		}
		const a = calls.get("100100290") ?? 0;
		const b = calls.get("100100029") ?? 0;
		expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
		expect(a + b).toBeGreaterThanOrEqual(44);
		expect(a + b).toBeLessThanOrEqual(46);
		expect(calls.get("subway-all")).toBe(45);
	});

	it("skips a source whose budget is spent", () => {
		const now = at("2026-11-04 12:00:00");
		const budget = consume(emptyBudget(now), "bus", now, 900);
		const plan = planTick(now, { nextAt: {} }, budget, dev);
		expect(plan.due).toEqual([{ kind: "subway-all" }]);
		expect(plan.nextAlarmAt).toBe(now + 80_000);
	});

	it("waits at least five seconds between alarms", () => {
		const now = at("2026-11-04 12:00:00");
		const schedule: ScheduleState = {
			nextAt: {
				"bus:100100029": now + 3000,
				"bus:100100290": now + 2000,
				subway: now + 1000,
			},
		};
		const plan = planTick(now, schedule, emptyBudget(now), dev);
		expect(plan.due).toEqual([]);
		expect(plan.nextAlarmAt).toBe(now + 5000);
	});

	it("prod plans one position call per line, capped by budget", () => {
		const now = at("2026-11-04 12:00:00");
		const config = prodConfig({}, ["r1", "r2"]);
		const plan = planTick(now, { nextAt: {} }, emptyBudget(now), config);
		const subway = plan.due.filter((call) => call.kind === "subway-position");
		expect(subway).toHaveLength(19);
		expect(subway[0]).toEqual({
			kind: "subway-position",
			lineNameKo: "1호선",
		});
		expect(plan.due.filter((call) => call.kind === "bus")).toHaveLength(2);
		expect(plan.schedule.nextAt["subway:2호선"]).toBeGreaterThan(now);

		const short = consume(emptyBudget(now), "subway", now, 895);
		const capped = planTick(now, { nextAt: {} }, short, config);
		expect(
			capped.due.filter((call) => call.kind === "subway-position")
		).toHaveLength(5);
	});
});

describe("extra bus routes", () => {
	const busDue = (plan: { due: CallPlan[] }): string[] =>
		plan.due.flatMap((call) => (call.kind === "bus" ? [call.routeId] : []));

	it("puts extra bus routes before configured routes and counts them in the interval", () => {
		const now = at("2026-11-04 12:00:00");
		const budget = emptyBudget(now);
		const config = prodConfig({}, ["r1", "r2"]);
		const plan = planTick(now, { nextAt: {} }, budget, config, ["x1", "r2"]);
		expect(busDue(plan)).toEqual(["x1", "r2", "r1"]);
		// 요청 노선까지 합친 소스 수(3)로 예산을 편다.
		const three = prodConfig({}, ["r1", "r2", "r3"]);
		expect(interval("bus", now, budget, config, ["x1", "r2"])).toBe(
			interval("bus", now, budget, three)
		);
		expect(interval("bus", now, budget, config, ["x1"])).toBeGreaterThan(
			interval("bus", now, budget, config)
		);
		expect(plan.schedule.nextAt["bus:x1"]).toBe(
			now + interval("bus", now, budget, config, ["x1"])
		);
	});

	it("in dev, the one due bus per tick prefers an extra route over a test route when both are due", () => {
		const now = at("2026-11-04 12:00:00");
		const schedule: ScheduleState = {
			nextAt: {
				"bus:123": now - 1000,
				"bus:100100029": now - 10 * MINUTE_MS,
				"bus:100100290": now - 20 * MINUTE_MS,
				subway: now + MINUTE_MS,
			},
		};
		const plan = planTick(now, schedule, emptyBudget(now), dev, ["123"]);
		expect(busDue(plan)).toEqual(["123"]);
		// 남은 시험 노선은 미뤄질 뿐 빠지지 않는다.
		expect(plan.schedule.nextAt["bus:100100290"]).toBeGreaterThan(now);
		expect(plan.schedule.nextAt["bus:100100029"]).toBeGreaterThan(now);
	});

	it("forgets past schedule keys of bus routes nobody polls any more", () => {
		const now = at("2026-11-04 12:00:00");
		const schedule: ScheduleState = {
			nextAt: {
				"bus:gone-due": now - 1000,
				"bus:gone-later": now + MINUTE_MS,
			},
		};
		const plan = planTick(now, schedule, emptyBudget(now), dev);
		expect(plan.schedule.nextAt).not.toHaveProperty("bus:gone-due");
		// 아직 오지 않은 시각은 남긴다(곧 다시 요청되면 간격을 지킨다).
		expect(plan.schedule.nextAt["bus:gone-later"]).toBe(now + MINUTE_MS);
	});
});

describe("token bucket", () => {
	it("allows a burst up to the rate, then refills", () => {
		const now = 1_000_000;
		let result = takeToken({ tokens: 2, updatedAt: now }, now, 2);
		expect(result.ok).toBe(true);
		result = takeToken(result.bucket, now, 2);
		expect(result.ok).toBe(true);
		result = takeToken(result.bucket, now, 2);
		expect(result.ok).toBe(false);
		expect(result.waitMs).toBe(500);
		result = takeToken(result.bucket, now + 500, 2);
		expect(result.ok).toBe(true);
	});
});

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
			OPERATING_END_KST: "00:30",
			OPERATING_START_KST: "06:00",
		});
		expect(config.operatingStart).toBe("06:00");
		expect(config.operatingEnd).toBe("00:30");
		expect(config.dailyBudget).toEqual({ bus: 400, subway: 500 });
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

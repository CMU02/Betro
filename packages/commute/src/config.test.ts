import { expect, test } from "bun:test";
import { commuteConfig } from "./config";

test("defaults", () => {
	const config = commuteConfig({});
	expect(config.tickMs).toBe(30_000);
	expect(config.busPollMs).toBe(60_000);
	expect(config.busNearPollMs).toBe(30_000);
	expect(config.busNearWindowMs).toBe(360_000);
	expect(config.dailyBudgetBusArrival).toBe(900);
	expect(config.suggestMinGainMs).toBe(180_000);
	expect(config.endGraceMs).toBe(600_000);
	expect(config.maxSessionMs).toBe(10_800_000);
	expect(config.heartbeatMs).toBe(110_000);
	expect(config.staleAfterMs).toBe(150_000);
	expect(config.tokenWaitMs).toBe(60_000);
	expect(config.subwayEtaBiasSec).toEqual({ line2: 60 });
});

test("env overrides and ignores garbage", () => {
	const config = commuteConfig({
		COMMUTE_BUS_POLL_MS: "abc",
		COMMUTE_SUBWAY_ETA_BIAS_SEC: '{"line2":30,"line9":"x"}',
		COMMUTE_TICK_MS: "5000",
	});
	expect(config.tickMs).toBe(5000);
	expect(config.busPollMs).toBe(60_000);
	expect(config.subwayEtaBiasSec).toEqual({ line2: 30 });
});

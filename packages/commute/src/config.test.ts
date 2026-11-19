import { expect, test } from "bun:test";
import { commuteConfig, marginSecFor } from "./config";

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

test("여유 폭 기본값은 임시값 bus 180·subway 120, 상한 300, 깜빡임 30", () => {
	const config = commuteConfig({});
	expect(config.leaveMarginSec).toEqual({ bus: 180, subway: 120 });
	expect(config.leaveMarginByLine).toEqual({});
	expect(config.leaveMarginMaxSec).toBe(300);
	expect(config.leaveSlackHysteresisSec).toBe(30);
});

test("환경 변수 JSON으로 덮어쓰고, 깨진 JSON이면 기본값", () => {
	const config = commuteConfig({
		COMMUTE_LEAVE_MARGIN_BY_LINE: '{"seoul-subway:line2":75}',
		COMMUTE_LEAVE_MARGIN_SEC: '{"bus":200,"subway":90}',
	});
	expect(config.leaveMarginSec).toEqual({ bus: 200, subway: 90 });
	expect(config.leaveMarginByLine).toEqual({ "seoul-subway:line2": 75 });
	expect(
		commuteConfig({ COMMUTE_LEAVE_MARGIN_SEC: "{" }).leaveMarginSec
	).toEqual({ bus: 180, subway: 120 });
	expect(
		commuteConfig({ COMMUTE_LEAVE_MARGIN_SEC: '{"bus":200}' }).leaveMarginSec
	).toEqual({ bus: 180, subway: 120 });
});

test("marginSecFor: 노선 키가 수단 기본값보다 먼저이고, 상한으로 자른다", () => {
	const config = commuteConfig({
		COMMUTE_LEAVE_MARGIN_BY_LINE: '{"seoul-subway:line2":75,"seoul-bus:1":900}',
	});
	expect(marginSecFor(config, "subway", "seoul-subway:line2")).toBe(75);
	expect(marginSecFor(config, "subway", "seoul-subway:line7")).toBe(120);
	expect(marginSecFor(config, "bus", "seoul-bus:1")).toBe(300);
});

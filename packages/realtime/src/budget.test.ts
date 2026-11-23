import { describe, expect, it } from "bun:test";
import { type BudgetState, consume, emptyBudget, remaining } from "./budget";
import { devConfig } from "./schedule";
import { kstToEpochMs } from "./time";

const at = (s: string): number => kstToEpochMs(s);
const config = devConfig({});

describe("budget", () => {
	it("counts calls per source within the kst day", () => {
		const now = at("2026-11-04 12:00:00");
		let state = emptyBudget(now);
		state = consume(state, "subway", now);
		state = consume(state, "subway", now, 2);
		state = consume(state, "bus", now);
		expect(state).toEqual({
			kstDay: "2026-11-04",
			used: { bus: 1, "gbis-position": 0, subway: 3, "tago-position": 0 },
		});
		expect(remaining(state, "subway", config, now)).toBe(897);
		expect(remaining(state, "bus", config, now)).toBe(899);
	});

	it("resets at kst midnight", () => {
		const late = at("2026-11-04 23:59:00");
		const full = { kstDay: "2026-11-04", used: { bus: 12, subway: 900 } };
		expect(remaining(full, "subway", config, late)).toBe(0);
		const after = at("2026-11-05 00:01:00");
		expect(remaining(full, "subway", config, after)).toBe(900);
		expect(consume(full, "bus", after)).toEqual({
			kstDay: "2026-11-05",
			used: { bus: 1, "gbis-position": 0, subway: 0, "tago-position": 0 },
		});
	});

	it("GBIS·TAGO 위치는 서울 버스와 따로 센다", () => {
		const now = at("2026-11-04 12:00:00");
		let state = emptyBudget(now);
		state = consume(state, "gbis-position", now, 2);
		state = consume(state, "tago-position", now);
		expect(remaining(state, "gbis-position", config, now)).toBe(298);
		expect(remaining(state, "tago-position", config, now)).toBe(2999);
		expect(remaining(state, "bus", config, now)).toBe(900);
	});

	it("옛 예산 상태(gbis-position 없음)를 읽어도 0으로 시작한다", () => {
		const now = at("2026-11-04 12:00:00");
		const old = {
			kstDay: "2026-11-04",
			used: { bus: 5, subway: 7 },
		} as unknown as BudgetState;
		expect(remaining(old, "gbis-position", config, now)).toBe(300);
		expect(remaining(old, "tago-position", config, now)).toBe(3000);
		const next = consume(old, "gbis-position", now);
		expect(next.used).toEqual({
			bus: 5,
			"gbis-position": 1,
			subway: 7,
			"tago-position": 0,
		});
	});

	it("never goes below zero", () => {
		const now = at("2026-11-04 12:00:00");
		const over = { kstDay: "2026-11-04", used: { bus: 0, subway: 950 } };
		expect(remaining(over, "subway", config, now)).toBe(0);
	});
});

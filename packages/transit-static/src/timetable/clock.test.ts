import { describe, expect, it } from "bun:test";
import { normalizeTripTimes, parseClock } from "./clock";
import type { StopTime } from "./model";

const stop = (seq: number, sec: number | null): StopTime => ({
	arriveSec: sec,
	departSec: sec,
	qualityFlags: [],
	seq,
	statnId: `100000000${seq}`,
});

describe("parseClock", () => {
	it("parses HH:MM:SS and HH:MM into seconds", () => {
		expect(parseClock("05:00:00")).toBe(18_000);
		expect(parseClock("25:10")).toBe(90_600);
	});
	it("keeps hours past 24 on the same service day", () => {
		expect(parseClock("24:05:00")).toBe(86_700);
	});
	it("treats midnight as null only when asked", () => {
		expect(parseClock("00:00:00", { midnightIsNull: true })).toBeNull();
		expect(parseClock("00:00", { midnightIsNull: true })).toBeNull();
		expect(parseClock("00:00:00")).toBe(0);
	});
	it("returns null for blank and dash", () => {
		expect(parseClock("")).toBeNull();
		expect(parseClock("   ")).toBeNull();
		expect(parseClock("-")).toBeNull();
	});
	it("throws on other formats and out-of-range values", () => {
		expect(() => parseClock("5시")).toThrow();
		expect(() => parseClock("30:00")).toThrow();
		expect(() => parseClock("12:60")).toThrow();
	});
});

describe("normalizeTripTimes", () => {
	it("adds a day from the point where the clock wraps past midnight", () => {
		const afterMidnight = stop(2, 300);
		const input = [stop(1, 85_800), afterMidnight];
		const out = normalizeTripTimes(input);
		expect(out.map((s) => s.arriveSec)).toEqual([85_800, 86_700]);
		expect(out.map((s) => s.departSec)).toEqual([85_800, 86_700]);
		expect(afterMidnight.arriveSec).toBe(300);
	});
	it("leaves times already past 86400 alone", () => {
		const out = normalizeTripTimes([stop(1, 85_800), stop(2, 86_700)]);
		expect(out.map((s) => s.arriveSec)).toEqual([85_800, 86_700]);
	});
	it("skips null times and does not mask small backwards steps", () => {
		const out = normalizeTripTimes([
			stop(1, 36_000),
			stop(2, null),
			stop(3, 35_940),
		]);
		expect(out.map((s) => s.arriveSec)).toEqual([36_000, null, 35_940]);
	});
});

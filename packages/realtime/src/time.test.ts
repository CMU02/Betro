import { describe, expect, it } from "bun:test";
import {
	isOperatingTime,
	kstDayStart,
	kstParts,
	kstToEpochMs,
	nextOperatingStart,
	serviceDayAt,
} from "./time";

const at = (s: string): number => kstToEpochMs(s);

describe("time", () => {
	it("parses both KST formats", () => {
		expect(kstToEpochMs("2026-11-03 12:41:21")).toBe(
			Date.UTC(2026, 10, 3, 3, 41, 21)
		);
		expect(kstToEpochMs("20261103130329")).toBe(
			Date.UTC(2026, 10, 3, 4, 3, 29)
		);
	});

	it("operating window crosses midnight", () => {
		const check = (t: string) =>
			isOperatingTime(at(`2026-11-04 ${t}`), "05:00", "01:00");
		expect(check("00:30:00")).toBe(true);
		expect(check("01:00:00")).toBe(false);
		expect(check("04:59:00")).toBe(false);
		expect(check("05:00:00")).toBe(true);
		expect(check("23:59:00")).toBe(true);
	});

	it("service day before 3am belongs to the previous date", () => {
		expect(serviceDayAt(at("2026-11-07 00:30:00"))).toEqual({
			date: "2026-11-06",
			serviceDay: "weekday",
		});
		expect(serviceDayAt(at("2026-11-07 10:00:00")).serviceDay).toBe("saturday");
		expect(serviceDayAt(at("2026-11-08 10:00:00")).serviceDay).toBe("holiday");
		expect(serviceDayAt(at("2026-12-25 10:00:00")).serviceDay).toBe("holiday");
	});

	it("computes kst parts, day start and next operating start", () => {
		const t = at("2026-11-04 18:11:00");
		expect(kstParts(t)).toEqual({
			date: "2026-11-04",
			dayOfWeek: 3,
			hour: 18,
			minute: 11,
		});
		expect(kstDayStart(t)).toBe(at("2026-11-04 00:00:00"));
		expect(nextOperatingStart(t, "05:00")).toBe(at("2026-11-05 05:00:00"));
		expect(nextOperatingStart(at("2026-11-04 02:00:00"), "05:00")).toBe(
			at("2026-11-04 05:00:00")
		);
	});
});

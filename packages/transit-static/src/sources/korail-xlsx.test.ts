import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseKorailXlsx } from "./korail-xlsx";

const FIXTURE = join(import.meta.dir, "__fixtures__", "korail-sample.xlsx");

describe("parseKorailXlsx", () => {
	it("reads one weekday train per column and skips blank cells", async () => {
		const bytes = await readFile(FIXTURE);
		const { trips, errors, sheets } = await parseKorailXlsx(
			bytes,
			"gyeongchun"
		);
		expect(errors).toEqual([]);
		expect(sheets).toEqual(["평일", "휴일"]);
		const weekday = trips.filter((t) => t.serviceDay === "weekday");
		expect(weekday.map((t) => t.trainNo)).toEqual(["1001", "1003"]);
		const [first, second] = weekday;
		expect(first?.direction).toBe("up");
		expect(first?.source).toBe("korail-xlsx");
		expect(first?.stops.map((s) => s.station.name)).toEqual(["가평", "청평"]);
		expect(first?.stops[0]?.depart).toBe("05:30");
		expect(second?.direction).toBe("down");
		expect(second?.stops.map((s) => s.station.name)).toEqual(["청평", "춘천"]);
	});

	it("copies the holiday sheet to saturday", async () => {
		const bytes = await readFile(FIXTURE);
		const { trips } = await parseKorailXlsx(bytes, "gyeongchun");
		const holiday = trips.filter((t) => t.serviceDay === "holiday");
		const saturday = trips.filter((t) => t.serviceDay === "saturday");
		expect(holiday).toHaveLength(1);
		expect(saturday).toHaveLength(1);
		expect(saturday[0]?.serviceDaySource).toBe("holiday-copied");
		expect(saturday[0]?.trainNo).toBe("2001");
	});

	it("reports a missing weekday or holiday sheet", async () => {
		await expect(
			parseKorailXlsx(new Uint8Array([1, 2, 3]), "gyeongchun")
		).rejects.toThrow();
	});
});

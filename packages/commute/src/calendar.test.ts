import { describe, expect, it } from "bun:test";
import {
	dueStart,
	localParts,
	localToEpochMs,
	startMinutesToCheck,
} from "./calendar";
import type { Schedule } from "./plan";

const SEOUL = "Asia/Seoul";
const NEW_YORK = "America/New_York";
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;

function schedule(overrides: Partial<Schedule> = {}): Schedule {
	return {
		days: [1, 2, 3, 4, 5],
		includeHolidays: false,
		leadMinutes: 10,
		leaveMinute: 8 * 60 + 10,
		timezone: SEOUL,
		...overrides,
	};
}

const noHoliday = () => false;

describe("localParts", () => {
	it("reads the local date, minute and weekday", () => {
		const instant = Date.UTC(2026, 10, 9, 15, 5);
		expect(localParts(instant, SEOUL)).toEqual({
			date: "2026-11-10",
			minute: 5,
			weekday: 2,
		});
		expect(localParts(instant, NEW_YORK)).toEqual({
			date: "2026-11-09",
			minute: 605,
			weekday: 1,
		});
	});
});

describe("localToEpochMs", () => {
	it("inverts localParts around midnight in two time zones", () => {
		for (const timezone of [SEOUL, NEW_YORK]) {
			for (const minute of [0, 1, 1439, 725]) {
				const epoch = localToEpochMs("2026-11-10", minute, timezone);
				expect(localParts(epoch, timezone)).toMatchObject({
					date: "2026-11-10",
					minute,
				});
			}
		}
	});
});

describe("dueStart", () => {
	// 2026-11-10 is a Tuesday.
	const tuesdayEight = localToEpochMs("2026-11-10", 8 * 60, SEOUL);

	it("starts at leave time minus the lead", () => {
		const due = dueStart(schedule(), tuesdayEight, noHoliday);
		expect(due).toEqual({
			leaveAt: tuesdayEight + 10 * MINUTE_MS,
			serviceDate: "2026-11-10",
			startAt: tuesdayEight,
		});
	});

	it("holds for three minutes after start and not before", () => {
		expect(
			dueStart(schedule(), tuesdayEight - SECOND_MS, noHoliday)
		).toBeNull();
		expect(
			dueStart(schedule(), tuesdayEight + 3 * MINUTE_MS - SECOND_MS, noHoliday)
		).not.toBeNull();
		expect(
			dueStart(schedule(), tuesdayEight + 3 * MINUTE_MS, noHoliday)
		).toBeNull();
	});

	it("skips days that are not scheduled", () => {
		const saturday = localToEpochMs("2026-11-14", 8 * 60, SEOUL);
		expect(dueStart(schedule(), saturday, noHoliday)).toBeNull();
	});

	it("starts the day before when leaving just after midnight", () => {
		const monday = schedule({ days: [1], leaveMinute: 5 });
		const sundayLate = localToEpochMs("2026-11-08", 23 * 60 + 55, SEOUL);
		const due = dueStart(monday, sundayLate, noHoliday);
		expect(due?.serviceDate).toBe("2026-11-09");
		expect(due?.startAt).toBe(sundayLate);
		const mondayLate = localToEpochMs("2026-11-09", 23 * 60 + 55, SEOUL);
		expect(dueStart(monday, mondayLate, noHoliday)).toBeNull();
	});

	it("judges holidays by the service date", () => {
		const holiday = (date: string) => date === "2026-11-10";
		expect(dueStart(schedule(), tuesdayEight, holiday)).toBeNull();
		expect(
			dueStart(schedule({ includeHolidays: true }), tuesdayEight, holiday)
		).not.toBeNull();

		const monday = schedule({ days: [1], leaveMinute: 5 });
		const sundayLate = localToEpochMs("2026-11-08", 23 * 60 + 55, SEOUL);
		const sundayHoliday = (date: string) => date === "2026-11-08";
		expect(dueStart(monday, sundayLate, sundayHoliday)).not.toBeNull();
	});
});

describe("startMinutesToCheck", () => {
	it("wraps past midnight", () => {
		const instant = localToEpochMs("2026-11-10", 1, SEOUL);
		expect(startMinutesToCheck(instant, SEOUL)).toEqual([1, 0, 1439]);
	});
});

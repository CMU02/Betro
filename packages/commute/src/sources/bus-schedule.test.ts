import { describe, expect, it } from "bun:test";
import { localToEpochMs } from "../calendar";
import { scheduledHeadwayMs } from "./bus-schedule";

/** 테스트 입력의 시간대. 구현 코드는 시간대를 인자로만 받는다. */
const TIMEZONE = "Asia/Seoul";
const HOUR_MINUTES = 60;
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** `yyyy-MM-ddTHH:mm`(TIMEZONE 현지) → epoch ms */
function kst(text: string): number {
	const match = LOCAL_TIME.exec(text);
	if (!match) {
		throw new Error(`invalid local time: ${text}`);
	}
	const [, date = "", hour = "0", minute = "0"] = match;
	return localToEpochMs(
		date,
		Number(hour) * HOUR_MINUTES + Number(minute),
		TIMEZONE
	);
}

const DAY = { firstBusMinute: 270, headwayMin: 10, lastBusMinute: 1370 };
const PAST_MIDNIGHT = {
	firstBusMinute: 270,
	headwayMin: 12,
	lastBusMinute: 90,
};

describe("scheduledHeadwayMs", () => {
	it("returns headway inside service hours", () => {
		expect(scheduledHeadwayMs(DAY, kst("2026-11-21T12:00"), TIMEZONE)).toBe(
			600_000
		);
	});

	it("returns null before first bus", () => {
		expect(
			scheduledHeadwayMs(DAY, kst("2026-11-21T04:00"), TIMEZONE)
		).toBeNull();
	});

	it("returns null after last bus", () => {
		expect(
			scheduledHeadwayMs(DAY, kst("2026-11-21T23:00"), TIMEZONE)
		).toBeNull();
	});

	it("counts the first and last bus minutes as in service", () => {
		expect(scheduledHeadwayMs(DAY, kst("2026-11-21T04:30"), TIMEZONE)).toBe(
			600_000
		);
		expect(scheduledHeadwayMs(DAY, kst("2026-11-21T22:50"), TIMEZONE)).toBe(
			600_000
		);
	});

	it("treats last bus past midnight as in service at 00:30", () => {
		expect(
			scheduledHeadwayMs(PAST_MIDNIGHT, kst("2026-11-21T00:30"), TIMEZONE)
		).toBe(720_000);
	});

	it("keeps a past-midnight route in service late in the evening", () => {
		expect(
			scheduledHeadwayMs(PAST_MIDNIGHT, kst("2026-11-21T23:30"), TIMEZONE)
		).toBe(720_000);
	});

	it("returns null between a past-midnight last bus and the first bus", () => {
		expect(
			scheduledHeadwayMs(PAST_MIDNIGHT, kst("2026-11-21T02:00"), TIMEZONE)
		).toBeNull();
	});

	it("gives headway at any time when first or last bus is unknown", () => {
		const at = kst("2026-11-21T03:00");
		expect(
			scheduledHeadwayMs(
				{ firstBusMinute: null, headwayMin: 8, lastBusMinute: 1370 },
				at,
				TIMEZONE
			)
		).toBe(480_000);
		expect(
			scheduledHeadwayMs(
				{ firstBusMinute: 270, headwayMin: 8, lastBusMinute: null },
				at,
				TIMEZONE
			)
		).toBe(480_000);
	});

	it("returns null for a non-positive headway", () => {
		expect(
			scheduledHeadwayMs(
				{ firstBusMinute: null, headwayMin: 0, lastBusMinute: null },
				kst("2026-11-21T12:00"),
				TIMEZONE
			)
		).toBeNull();
	});
});

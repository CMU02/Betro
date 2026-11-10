import type { ServiceDay } from "@Betro/db/schema/transit";
import { KOREAN_PUBLIC_HOLIDAYS } from "./holidays";

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const SERVICE_DAY_ROLLOVER_HOUR = 3;
const SATURDAY = 6;
const SUNDAY = 0;
const DASHED = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const HHMM = /^(\d{1,2}):(\d{2})$/;

/** `"2026-11-03 12:41:21"` 또는 `"20261103130329"`(KST)를 UTC epoch ms로. */
export function kstToEpochMs(s: string): number {
	const m = DASHED.exec(s) ?? COMPACT.exec(s);
	if (!m) {
		throw new Error(`Unrecognized KST timestamp: ${s}`);
	}
	const [, y, mo, d, h, mi, se] = m.map(Number);
	return (
		Date.UTC(y as number, (mo as number) - 1, d, h, mi, se) - KST_OFFSET_MS
	);
}

export function kstParts(epochMs: number): {
	date: string;
	dayOfWeek: number;
	hour: number;
	minute: number;
} {
	const d = new Date(epochMs + KST_OFFSET_MS);
	const pad = (n: number): string => String(n).padStart(2, "0");
	return {
		date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
		dayOfWeek: d.getUTCDay(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
	};
}

function parseHhmm(s: string): number {
	const m = HHMM.exec(s);
	if (!m) {
		throw new Error(`Invalid HH:MM: ${s}`);
	}
	return Number(m[1]) * 60 + Number(m[2]);
}

export function kstDayStart(epochMs: number): number {
	return (
		Math.floor((epochMs + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS
	);
}

function minuteOfDay(epochMs: number): number {
	return Math.floor((epochMs - kstDayStart(epochMs)) / MINUTE_MS);
}

/** 끝이 시작보다 이르면 자정을 넘기는 구간. 시작 포함, 끝 미포함. */
export function isOperatingTime(
	epochMs: number,
	start: string,
	end: string
): boolean {
	const s = parseHhmm(start);
	const e = parseHhmm(end);
	const now = minuteOfDay(epochMs);
	if (s === e) {
		return true;
	}
	return s < e ? now >= s && now < e : now >= s || now < e;
}

/** `epochMs`보다 엄격히 뒤의 가장 가까운 운행 시작 시각. 이미 운행 중이면 다음 날 시작 시각이다. */
export function nextOperatingStart(epochMs: number, start: string): number {
	const s = parseHhmm(start) * MINUTE_MS;
	const today = kstDayStart(epochMs) + s;
	return today > epochMs ? today : today + DAY_MS;
}

export function serviceDayAt(epochMs: number): {
	date: string;
	serviceDay: ServiceDay;
} {
	const { hour } = kstParts(epochMs);
	const shifted = hour < SERVICE_DAY_ROLLOVER_HOUR ? epochMs - DAY_MS : epochMs;
	const { date, dayOfWeek } = kstParts(shifted);
	if (KOREAN_PUBLIC_HOLIDAYS.has(date) || dayOfWeek === SUNDAY) {
		return { date, serviceDay: "holiday" };
	}
	return { date, serviceDay: dayOfWeek === SATURDAY ? "saturday" : "weekday" };
}

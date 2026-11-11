import type { Schedule } from "./plan";

export interface LocalParts {
	date: string;
	minute: number;
	weekday: number;
}

export interface DueStart {
	leaveAt: number;
	serviceDate: string;
	startAt: number;
}

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;
const HOUR_MINUTES = 60;
/** 서버가 안내 시작 시각부터 이 시간 안에 세션을 연다. 앱도 이 사이는 "오늘" 안내로 본다. */
export const START_WINDOW_MINUTES = 3;
const CHECK_MINUTES = 3;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
	const cached = formatters.get(timezone);
	if (cached) {
		return cached;
	}
	const created = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		month: "2-digit",
		timeZone: timezone,
		year: "numeric",
	});
	formatters.set(timezone, created);
	return created;
}

interface Fields {
	day: number;
	hour: number;
	minute: number;
	month: number;
	year: number;
}

function fieldsOf(epochMs: number, timezone: string): Fields {
	const fields: Fields = { day: 0, hour: 0, minute: 0, month: 0, year: 0 };
	for (const part of formatterFor(timezone).formatToParts(epochMs)) {
		if (part.type in fields) {
			fields[part.type as keyof Fields] = Number(part.value);
		}
	}
	return fields;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, "0");
}

function weekdayOf(date: string): number {
	const match = DATE_PATTERN.exec(date);
	if (!match) {
		throw new Error(`invalid date: ${date}`);
	}
	return new Date(
		Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
	).getUTCDay();
}

export function localParts(epochMs: number, timezone: string): LocalParts {
	const { day, hour, minute, month, year } = fieldsOf(epochMs, timezone);
	const date = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
	return {
		date,
		minute: hour * HOUR_MINUTES + minute,
		weekday: weekdayOf(date),
	};
}

function offsetMs(epochMs: number, timezone: string): number {
	const { day, hour, minute, month, year } = fieldsOf(epochMs, timezone);
	const asUtc = Date.UTC(year, month - 1, day, hour, minute);
	return asUtc - Math.floor(epochMs / MINUTE_MS) * MINUTE_MS;
}

export function localToEpochMs(
	date: string,
	minute: number,
	timezone: string
): number {
	const match = DATE_PATTERN.exec(date);
	if (!match) {
		throw new Error(`invalid date: ${date}`);
	}
	const wall = Date.UTC(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3]),
		0,
		minute
	);
	const first = wall - offsetMs(wall, timezone);
	return wall - offsetMs(first, timezone);
}

export function dueStart(
	schedule: Schedule,
	now: number,
	isHoliday: (date: string) => boolean
): DueStart | null {
	const leadMs = schedule.leadMinutes * MINUTE_MS;
	const windowMs = START_WINDOW_MINUTES * MINUTE_MS;
	const latestLeave = now + leadMs;
	const dates = new Set([
		localParts(latestLeave, schedule.timezone).date,
		localParts(latestLeave - windowMs, schedule.timezone).date,
	]);
	for (const serviceDate of dates) {
		const leaveAt = localToEpochMs(
			serviceDate,
			schedule.leaveMinute,
			schedule.timezone
		);
		const startAt = leaveAt - leadMs;
		const inWindow = now >= startAt && now < startAt + windowMs;
		if (!inWindow) {
			continue;
		}
		if (!schedule.days.includes(weekdayOf(serviceDate))) {
			continue;
		}
		if (!schedule.includeHolidays && isHoliday(serviceDate)) {
			continue;
		}
		return { leaveAt, serviceDate, startAt };
	}
	return null;
}

export function startMinutesToCheck(now: number, timezone: string): number[] {
	const minutes: number[] = [];
	for (let back = 0; back < CHECK_MINUTES; back += 1) {
		const { minute } = localParts(now - back * MINUTE_MS, timezone);
		minutes.push((minute + DAY_MINUTES) % DAY_MINUTES);
	}
	return minutes;
}

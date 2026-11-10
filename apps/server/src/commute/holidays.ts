import { localParts } from "@Betro/commute/calendar";
import type { Database } from "@Betro/db";
import { holiday } from "@Betro/db/schema/commute";
import { redactKeys } from "@Betro/realtime/upstream/urls";
import { and, eq, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import type { Upstream } from "../collector/ports";
import { safeFetch } from "../collector/upstream-call";

const REST_DAYS_ENDPOINT =
	"https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const COUNTRY = "KR";
const RESULT_OK = "00";
const HTTP_OK = 200;
const ROWS_PER_PAGE = 100;
/** 마지막 성공에서 이만큼 지나야 다시 받는다. */
export const HOLIDAY_REFRESH_MS = 24 * 3_600_000;
const LOCDATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

export interface RestDay {
	date: string;
	name: string;
}

const itemSchema = z.object({
	dateName: z.string(),
	isHoliday: z.string(),
	locdate: z.union([z.number(), z.string()]),
});

const envelopeSchema = z.object({
	response: z.object({
		body: z
			.object({
				// 0건이면 ""(빈 문자열), 1건이면 객체, 여러 건이면 배열이다.
				items: z
					.union([
						z.literal(""),
						z.object({ item: z.union([itemSchema, z.array(itemSchema)]) }),
					])
					.optional(),
			})
			.optional(),
		header: z.object({ resultCode: z.string() }),
	}),
});

function dashed(locdate: number | string): string | null {
	const match = LOCDATE_PATTERN.exec(String(locdate));
	return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** `getRestDeInfo` JSON 응답. 공휴일(`isHoliday` Y)만 낸다. 읽을 수 없거나 오류 코드면 null. */
export function parseRestDays(json: string): RestDay[] | null {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return null;
	}
	const parsed = envelopeSchema.safeParse(raw);
	if (!parsed.success || parsed.data.response.header.resultCode !== RESULT_OK) {
		return null;
	}
	const items = parsed.data.response.body?.items;
	if (items === undefined || items === "") {
		return [];
	}
	const list = Array.isArray(items.item) ? items.item : [items.item];
	const days: RestDay[] = [];
	for (const item of list) {
		const date = dashed(item.locdate);
		if (item.isHoliday === "Y" && date !== null) {
			days.push({ date, name: item.dateName });
		}
	}
	return days;
}

/**
 * 한 INSERT에 넣는 행 수. D1은 한 문장의 바인딩 값을 100개까지만 받고, 한 행이 4개를 쓴다.
 * 두 해를 한 문장으로 넣으면 한도를 넘는다(2027년만 24행).
 */
const ROWS_PER_INSERT = 20;

export function restDaysUrl(key: string, year: number): string {
	return `${REST_DAYS_ENDPOINT}?serviceKey=${encodeURIComponent(key)}&solYear=${year}&numOfRows=${ROWS_PER_PAGE}&_type=json`;
}

export interface RefreshDeps {
	db: Database;
	fetch: Upstream;
	key: string;
	now: number;
	timezone: string;
}

async function fetchYear(
	deps: RefreshDeps,
	year: number
): Promise<RestDay[] | string> {
	const response = await safeFetch(deps.fetch, restDaysUrl(deps.key, year));
	if (response.status !== HTTP_OK) {
		const reason = response.error ?? `status ${response.status}`;
		return `holidays ${year}: ${redactKeys(reason, [deps.key])}`;
	}
	return (
		parseRestDays(response.body) ?? `holidays ${year}: unreadable response`
	);
}

/**
 * 올해와 내년을 받아 그 두 해의 `KR` 행을 통째로 바꾼다. 한 해라도 실패하면 아무것도 바꾸지
 * 않는다. 지우기와 넣기는 한 batch(D1에서 한 트랜잭션)로 보낸다.
 */
export async function refreshHolidays(
	deps: RefreshDeps
): Promise<{ fetched: number } | { error: string }> {
	const thisYear = Number(localParts(deps.now, deps.timezone).date.slice(0, 4));
	const years = [thisYear, thisYear + 1];
	const results = await Promise.all(years.map((year) => fetchYear(deps, year)));
	const days: RestDay[] = [];
	for (const result of results) {
		if (typeof result === "string") {
			return { error: result };
		}
		days.push(...result);
	}
	const prefixes = years.map((year) => `${year}-%`);
	const removeOld = deps.db.delete(holiday).where(
		and(
			eq(holiday.country, COUNTRY),
			sql`(${sql.join(
				prefixes.map((prefix) => sql`${holiday.date} like ${prefix}`),
				sql` or `
			)})`
		)
	);
	const rows = days.map((day) => ({
		country: COUNTRY,
		date: day.date,
		fetchedAt: deps.now,
		name: day.name,
	}));
	const inserts: BatchItem<"sqlite">[] = [];
	for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
		inserts.push(
			deps.db.insert(holiday).values(rows.slice(start, start + ROWS_PER_INSERT))
		);
	}
	try {
		await deps.db.batch([removeOld, ...inserts]);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return { error: `holidays store: ${redactKeys(text, [deps.key])}` };
	}
	return { fetched: rows.length };
}

/** 마지막 성공(`holiday.fetched_at` 최댓값)에서 24시간이 지났거나 받은 적이 없으면 true. */
export async function holidaysDue(db: Database, now: number): Promise<boolean> {
	const [row] = await db
		.select({ last: max(holiday.fetchedAt) })
		.from(holiday)
		.where(eq(holiday.country, COUNTRY));
	const last = row?.last ?? null;
	return last === null || now - last >= HOLIDAY_REFRESH_MS;
}

export interface RefreshIfDueDeps {
	db: Database;
	key: string;
	now: number;
	timezone: string;
	upstream: { mode: "live" | "fixture"; upstream: Upstream };
}

/**
 * cron용. 표본 모드이거나 키가 없으면 건너뛰고, 마지막 성공에서 24시간이 지나지 않았어도
 * 건너뛴다. 실패하면 (키를 가린) 오류를 던져 cron 로그에 남긴다.
 */
export async function refreshHolidaysIfDue(
	deps: RefreshIfDueDeps
): Promise<void> {
	if (deps.upstream.mode !== "live" || deps.key === "") {
		return;
	}
	if (!(await holidaysDue(deps.db, deps.now))) {
		return;
	}
	const result = await refreshHolidays({
		db: deps.db,
		fetch: deps.upstream.upstream,
		key: deps.key,
		now: deps.now,
		timezone: deps.timezone,
	});
	if ("error" in result) {
		throw new Error(result.error);
	}
}

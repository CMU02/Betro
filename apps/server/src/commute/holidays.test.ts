import { holiday } from "@Betro/db/schema/commute";
import { createTestDb } from "@Betro/db/test-db";
import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import type { Upstream, UpstreamResponse } from "../collector/ports";
import rest2026_11 from "./__fixtures__/rest-days-2026-11.json";
import rest2026_12 from "./__fixtures__/rest-days-2026-12.json";
import rest2027 from "./__fixtures__/rest-days-2027.json";
import { D1PlanStore } from "./cf-ports";
import {
	HOLIDAY_REFRESH_MS,
	holidaysDue,
	parseRestDays,
	refreshHolidays,
	restDaysUrl,
} from "./holidays";

const KEY = "SECRET/KEY+value==";
const HOUR_MS = 3_600_000;
const NOW = Date.UTC(2026, 10, 10, 3, 0, 0);
const TIMEZONE = "Asia/Seoul";
/** D1은 한 문장에 바인딩 값을 100개까지만 받는다. */
const D1_MAX_BOUND_PARAMS = 100;

const json = (value: unknown): string => JSON.stringify(value);

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeEach(async () => {
	db = await createTestDb();
});

function upstreamOf(
	handler: (url: string) => UpstreamResponse
): Upstream & { urls: string[] } {
	const urls: string[] = [];
	return {
		fetch: (url) => {
			urls.push(url);
			return Promise.resolve(handler(url));
		},
		urls,
	};
}

const ok = (body: unknown): UpstreamResponse => ({
	body: json(body),
	status: 200,
});

describe("parseRestDays", () => {
	it("2027년 표본에서 24건이 나오고 대체공휴일 이름이 그대로다", () => {
		const days = parseRestDays(json(rest2027));
		expect(days).toHaveLength(24);
		expect(days?.find((day) => day.date === "2027-02-09")?.name).toBe(
			"대체공휴일(설날)"
		);
	});

	it("한 건 표본(item이 객체)에서 1건을 낸다", () => {
		expect(parseRestDays(json(rest2026_12))).toEqual([
			{ date: "2026-12-25", name: "기독탄신일" },
		]);
	});

	it("0건 표본(items가 빈 문자열)에서 빈 배열을 낸다", () => {
		expect(parseRestDays(json(rest2026_11))).toEqual([]);
	});

	it("isHoliday가 N인 항목은 뺀다", () => {
		const body = {
			response: {
				body: {
					items: {
						item: [
							{ dateName: "식목일", isHoliday: "N", locdate: 20_270_405 },
							{ dateName: "삼일절", isHoliday: "Y", locdate: 20_270_301 },
						],
					},
				},
				header: { resultCode: "00" },
			},
		};
		expect(parseRestDays(json(body))).toEqual([
			{ date: "2027-03-01", name: "삼일절" },
		]);
	});

	it("resultCode가 00이 아니면 null이다", () => {
		const body = { response: { header: { resultCode: "30" } } };
		expect(parseRestDays(json(body))).toBeNull();
	});

	it("XML 오류 본문과 JSON이 아닌 입력은 null이다", () => {
		const xml =
			"<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
		expect(parseRestDays(xml)).toBeNull();
		expect(parseRestDays("")).toBeNull();
	});
});

describe("restDaysUrl", () => {
	it("json, numOfRows=100, 연도를 쓰고 solMonth는 없으며 키를 인코딩한다", () => {
		const url = restDaysUrl(KEY, 2027);
		expect(url).toContain("getRestDeInfo");
		expect(url).toContain("_type=json");
		expect(url).toContain("numOfRows=100");
		expect(url).toContain("solYear=2027");
		expect(url).not.toContain("solMonth");
		expect(url).toContain(`serviceKey=${encodeURIComponent(KEY)}`);
	});
});

const LOCDATE_YEAR_STEP = 10_000;

/** 2027년 표본의 날짜를 한 해 앞당긴 응답. 두 해를 합치면 48건이 된다. */
function rest2027AsLastYear(): unknown {
	const copy = structuredClone(rest2027);
	for (const item of copy.response.body.items.item) {
		item.locdate -= LOCDATE_YEAR_STEP;
	}
	return copy;
}

async function rowsOf(year: string) {
	const rows = await db.select().from(holiday);
	return rows.filter((row) => row.date.startsWith(year));
}

describe("refreshHolidays", () => {
	it("올해와 내년을 받아 넣고, 응답에 없는 옛 행은 지운다", async () => {
		await db.insert(holiday).values([
			{ country: "KR", date: "2026-11-20", fetchedAt: 1, name: "취소된 임시" },
			{ country: "KR", date: "2027-04-01", fetchedAt: 1, name: "취소된 임시" },
			{ country: "KR", date: "2028-01-01", fetchedAt: 1, name: "다른 해" },
			{ country: "US", date: "2026-12-25", fetchedAt: 1, name: "Christmas" },
		]);
		const upstream = upstreamOf((url) =>
			url.includes("solYear=2026") ? ok(rest2026_12) : ok(rest2027)
		);
		const result = await refreshHolidays({
			db,
			fetch: upstream,
			key: KEY,
			now: NOW,
			timezone: TIMEZONE,
		});
		expect(result).toEqual({ fetched: 25 });
		expect(upstream.urls).toHaveLength(2);
		expect(await rowsOf("2026")).toHaveLength(2);
		expect(await rowsOf("2027")).toHaveLength(24);
		const stale = await db
			.select()
			.from(holiday)
			.where(and(eq(holiday.country, "KR"), eq(holiday.date, "2026-11-20")));
		expect(stale).toHaveLength(0);
		const other = await db
			.select()
			.from(holiday)
			.where(eq(holiday.date, "2028-01-01"));
		expect(other).toHaveLength(1);
		const us = await db.select().from(holiday).where(eq(holiday.country, "US"));
		expect(us).toHaveLength(1);
		const seol = await db
			.select()
			.from(holiday)
			.where(eq(holiday.date, "2027-02-09"));
		expect(seol[0]?.name).toBe("대체공휴일(설날)");
		expect(seol[0]?.fetchedAt).toBe(NOW);
	});

	it("한 문장의 바인딩 값이 D1 한도(100개)를 넘지 않게 나눠 넣는다", async () => {
		const paramCounts: number[] = [];
		const counting = new Proxy(db, {
			get(target, prop, receiver) {
				if (prop === "batch") {
					return (statements: { toSQL: () => { params: unknown[] } }[]) => {
						for (const statement of statements) {
							paramCounts.push(statement.toSQL().params.length);
						}
						return target.batch(statements as never);
					};
				}
				return Reflect.get(target, prop, receiver);
			},
		});
		const result = await refreshHolidays({
			db: counting,
			fetch: upstreamOf((url) =>
				url.includes("solYear=2026") ? ok(rest2027AsLastYear()) : ok(rest2027)
			),
			key: KEY,
			now: NOW,
			timezone: TIMEZONE,
		});
		expect(result).toEqual({ fetched: 48 });
		expect(paramCounts.length).toBeGreaterThan(2);
		expect(Math.max(...paramCounts)).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
		expect(await rowsOf("2027")).toHaveLength(24);
	});

	it("둘째 해에서 실패하면 error를 내고 기존 행이 그대로며 문구에 키가 없다", async () => {
		await db.insert(holiday).values({
			country: "KR",
			date: "2026-11-20",
			fetchedAt: 1,
			name: "기존",
		});
		const upstream = upstreamOf((url) =>
			url.includes("solYear=2026")
				? ok(rest2026_12)
				: {
						body: "",
						error: `connect failed ${url}`,
						status: null,
					}
		);
		const result = await refreshHolidays({
			db,
			fetch: upstream,
			key: KEY,
			now: NOW,
			timezone: TIMEZONE,
		});
		expect("error" in result).toBe(true);
		const text = JSON.stringify(result);
		expect(text).not.toContain(KEY);
		expect(text).not.toContain(encodeURIComponent(KEY));
		const rows = await db.select().from(holiday);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.date).toBe("2026-11-20");
	});

	it("응답을 읽을 수 없어도 아무것도 바꾸지 않는다", async () => {
		await db.insert(holiday).values({
			country: "KR",
			date: "2026-11-20",
			fetchedAt: 1,
			name: "기존",
		});
		const upstream = upstreamOf(() => ({ body: "<xml/>", status: 200 }));
		const result = await refreshHolidays({
			db,
			fetch: upstream,
			key: KEY,
			now: NOW,
			timezone: TIMEZONE,
		});
		expect("error" in result).toBe(true);
		expect(await db.select().from(holiday)).toHaveLength(1);
	});
});

describe("isHoliday", () => {
	it("테이블에만 있는 임시공휴일은 true다", async () => {
		await db.insert(holiday).values({
			country: "KR",
			date: "2026-11-20",
			fetchedAt: NOW,
			name: "임시공휴일",
		});
		expect(await new D1PlanStore(db).isHoliday("KR", "2026-11-20")).toBe(true);
	});

	it("고정 목록에만 있는 날도 true다", async () => {
		expect(await new D1PlanStore(db).isHoliday("KR", "2026-12-25")).toBe(true);
	});

	it("둘 다 없으면 false다", async () => {
		expect(await new D1PlanStore(db).isHoliday("KR", "2026-11-11")).toBe(false);
	});
});

describe("holidaysDue", () => {
	it("받은 적이 없으면 받을 때다", async () => {
		expect(await holidaysDue(db, NOW)).toBe(true);
	});

	it("23시간 전에 받았으면 아직이다", async () => {
		await db.insert(holiday).values({
			country: "KR",
			date: "2027-01-01",
			fetchedAt: NOW - 23 * HOUR_MS,
			name: "신정",
		});
		expect(await holidaysDue(db, NOW)).toBe(false);
	});

	it("24시간이 지났으면 받을 때다", async () => {
		await db.insert(holiday).values({
			country: "KR",
			date: "2027-01-01",
			fetchedAt: NOW - HOLIDAY_REFRESH_MS,
			name: "신정",
		});
		expect(await holidaysDue(db, NOW)).toBe(true);
	});
});

import { describe, expect, it } from "bun:test";
import {
	fetchStationMaster,
	parseSeoulEnvelope,
	seoulApiUrl,
} from "./seoul-open-api";

const ok = (rows: unknown[], total = rows.length) => ({
	subwayStationMaster: {
		list_total_count: total,
		RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" },
		row: rows,
	},
});
const asResponse = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200 });

describe("parseSeoulEnvelope", () => {
	it("returns rows on INFO-000", () => {
		const r = parseSeoulEnvelope(
			"subwayStationMaster",
			ok([{ BLDN_ID: "0150" }])
		);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.rows[0]?.BLDN_ID).toBe("0150");
		}
	});
	it("treats INFO-200 as empty success", () => {
		const r = parseSeoulEnvelope("x", {
			RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." },
		});
		expect(r).toEqual({ ok: true, rows: [], totalCount: 0 });
	});
	it("returns error code on ERROR-*", () => {
		const r = parseSeoulEnvelope("x", {
			RESULT: { CODE: "ERROR-300", MESSAGE: "필수 값이 누락" },
		});
		expect(r).toEqual({
			code: "ERROR-300",
			message: "필수 값이 누락",
			ok: false,
		});
	});
});

describe("seoulApiUrl", () => {
	it("percent-encodes the trailing path", () => {
		expect(
			seoulApiUrl("K", "SearchInfoBySubwayNameService", 1, 5, "대곡")
		).toBe(
			"http://openapi.seoul.go.kr:8088/K/json/SearchInfoBySubwayNameService/1/5/%EB%8C%80%EA%B3%A1"
		);
	});
});

describe("fetchStationMaster", () => {
	it("coerces LAT/LOT to numbers and pages past 1000", async () => {
		const calls: string[] = [];
		const page1 = Array.from({ length: 1000 }, (_, i) => ({
			BLDN_ID: String(i),
			BLDN_NM: "역",
			LAT: "37.5",
			LOT: "127.0",
			ROUTE: "1호선",
		}));
		const page2 = [
			{
				BLDN_ID: "1000",
				BLDN_NM: "역",
				LAT: "37.6",
				LOT: "127.1",
				ROUTE: "1호선",
			},
		];
		const fetchImpl = (url: string | URL | Request) => {
			calls.push(String(url));
			return Promise.resolve(
				asResponse(calls.length === 1 ? ok(page1, 1001) : ok(page2, 1001))
			);
		};
		const r = await fetchStationMaster("K", fetchImpl as typeof fetch);
		expect(calls[0]).toContain("/subwayStationMaster/1/1000/");
		expect(calls[1]).toContain("/subwayStationMaster/1001/2000/");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.rows.length).toBe(1001);
			expect(r.rows[1000]).toEqual({
				bldnId: "1000",
				bldnNm: "역",
				lat: 37.6,
				lng: 127.1,
				route: "1호선",
			});
		}
	});
});

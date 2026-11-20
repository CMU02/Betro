import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { maskKey } from "./seoul-bus-api";
import {
	parseTagoRouteInfo,
	parseTagoRouteList,
	parseTagoRouteStations,
	tagoUrl,
} from "./tago-api";

const CITY_CODE = "23";
const ROUTE_COUNT = 363;
const STATION_COUNT = 101;

function fixture(name: string): unknown {
	return JSON.parse(
		readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")
	);
}

function errorFixture(name: string): unknown {
	const wrapped = fixture(name) as { body: string };
	return JSON.parse(wrapped.body);
}

describe("parseTagoRouteList", () => {
	it("인천 노선을 읽고 번호를 문자열로 낸다", () => {
		const result = parseTagoRouteList(
			fixture("tago-route-list-23.json"),
			CITY_CODE
		);
		if (!result.ok) {
			throw new Error("ok여야 한다");
		}
		expect(result.items).toHaveLength(ROUTE_COUNT);
		expect(result.items[0]).toEqual({
			areaName: "인천",
			cityCode: CITY_CODE,
			name: "523",
			routeId: "ICB365000085",
			routeTypeCode: "지선버스",
		});
	});
});

describe("parseTagoRouteInfo", () => {
	it("객체 하나로 온 노선 정보에서 간격·첫차·막차를 읽는다", () => {
		const result = parseTagoRouteInfo(
			fixture("tago-route-info.json"),
			CITY_CODE
		);
		expect(result).toEqual({
			items: [
				{
					firstBusMinute: 4 * 60 + 40,
					headwayMin: 15,
					lastBusMinute: 23 * 60,
				},
			],
			ok: true,
		});
	});

	it("막차 0000(자정)은 null이다", () => {
		const json = {
			response: {
				body: {
					items: {
						item: { endvehicletime: "0000", startvehicletime: "0504" },
					},
				},
				header: { resultCode: "00" },
			},
		};
		expect(parseTagoRouteInfo(json, CITY_CODE)).toEqual({
			items: [
				{ firstBusMinute: 5 * 60 + 4, headwayMin: null, lastBusMinute: null },
			],
			ok: true,
		});
	});
});

describe("parseTagoRouteStations", () => {
	it("gpslong이 문자열이어도 숫자로 읽고 nodeord 순으로 낸다", () => {
		const result = parseTagoRouteStations(
			fixture("tago-route-stations.json"),
			CITY_CODE
		);
		if (!result.ok) {
			throw new Error("ok여야 한다");
		}
		expect(result.items).toHaveLength(STATION_COUNT);
		expect(result.items.map((stop) => stop.seq)).toEqual(
			Array.from({ length: STATION_COUNT }, (_, index) => index + 1)
		);
		for (const stop of result.items) {
			expect(typeof stop.lat).toBe("number");
			expect(typeof stop.lng).toBe("number");
		}
		// 첫 정류장은 gpslati가 문자열이다.
		expect(result.items[0]?.lat).toBe(37.399_93);
		expect(result.items[0]?.stationId).toBe("ICB364000795");
		expect(result.items[0]?.arsId).toBe("38793");
	});

	it("gpslong이 문자열인 항목도 숫자로 읽는다", () => {
		const json = {
			response: {
				body: {
					items: {
						item: [
							{
								gpslati: "37.5",
								gpslong: "126.7",
								nodeid: "ICB1",
								nodenm: "가",
								nodeord: 1,
							},
						],
					},
				},
				header: { resultCode: "00" },
			},
		};
		const result = parseTagoRouteStations(json, CITY_CODE);
		expect(result.ok && result.items[0]?.lng).toBe(126.7);
	});
});

describe("TAGO 실패 봉투", () => {
	it("인증 실패는 auth, 한도 초과는 quota다", () => {
		expect(
			parseTagoRouteList(errorFixture("tago-error-auth.json"), CITY_CODE)
		).toEqual({ ok: false, reason: "auth" });
		expect(
			parseTagoRouteList(errorFixture("gbis-error-quota.json"), CITY_CODE)
		).toEqual({ ok: false, reason: "quota" });
	});

	it("빈 items와 resultCode 03은 no-data다", () => {
		const empty = {
			response: { body: { items: "" }, header: { resultCode: "00" } },
		};
		const noData = { response: { header: { resultCode: "03" } } };
		expect(parseTagoRouteList(empty, CITY_CODE)).toEqual({
			ok: false,
			reason: "no-data",
		});
		expect(parseTagoRouteList(noData, CITY_CODE)).toEqual({
			ok: false,
			reason: "no-data",
		});
	});

	it("모양이 다르면 malformed다", () => {
		expect(parseTagoRouteList(null, CITY_CODE)).toEqual({
			ok: false,
			reason: "malformed",
		});
	});
});

describe("tagoUrl", () => {
	it("maskKey로 가리면 키가 남지 않는다", () => {
		const key = "abc+/def==secret";
		const url = tagoUrl(
			"getRouteNoList",
			{ numOfRows: "3000" },
			key,
			CITY_CODE
		);
		// 서비스키가 평문으로 가지 않게 https로 부른다(2026-11-21 TAGO https 응답 확인).
		expect(url.startsWith("https://apis.data.go.kr/1613000/")).toBe(true);
		expect(url).toContain("cityCode=23");
		expect(url).toContain("_type=json");
		const masked = maskKey(url, key);
		expect(masked).not.toContain("secret");
		expect(masked).not.toContain(encodeURIComponent(key));
	});
});

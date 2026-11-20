import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	gbisUrl,
	parseGbisRouteInfo,
	parseGbisRouteList,
	parseGbisRouteStations,
} from "./gbis-api";
import { maskKey } from "./seoul-bus-api";

function fixture(name: string): unknown {
	return JSON.parse(
		readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")
	);
}

/** 에러 자료는 `{ httpStatus, body }`로 감싸 있고 body가 문자열이다. */
function errorFixture(name: string): unknown {
	const wrapped = fixture(name) as { body: string };
	return JSON.parse(wrapped.body);
}

const ROUTE_ID = "241308701";
const STATION_COUNT = 40;
const WEEKDAY_HEADWAY_MIN = 10;
const FIRST_BUS_MINUTE = 6 * 60;
const LAST_BUS_MINUTE = 23 * 60 + 10;

describe("parseGbisRouteStations", () => {
	it("정류장을 seq 순서로 읽고 좌표를 숫자로 낸다", () => {
		const result = parseGbisRouteStations(
			fixture(`gbis-route-stations-${ROUTE_ID}.json`)
		);
		if (!result.ok) {
			throw new Error("ok여야 한다");
		}
		expect(result.items).toHaveLength(STATION_COUNT);
		expect(result.items.map((stop) => stop.seq)).toEqual(
			Array.from({ length: STATION_COUNT }, (_, index) => index + 1)
		);
		const [first] = result.items;
		expect(first?.stationId).toBe("218000033");
		expect(first?.lat).toBe(37.6023);
		expect(first?.lng).toBe(126.814_533_3);
		// mobileNo 앞의 공백은 지운다.
		expect(first?.arsId).toBe("19012");
		expect(first?.turnSeq).toBe(22);
	});
});

describe("parseGbisRouteInfo", () => {
	it("평일 배차간격과 첫차·막차를 분으로 읽는다", () => {
		const result = parseGbisRouteInfo(
			fixture(`gbis-route-info-${ROUTE_ID}.json`)
		);
		if (!result.ok) {
			throw new Error("ok여야 한다");
		}
		expect(result.items).toEqual([
			{
				firstBusMinute: FIRST_BUS_MINUTE,
				headwayMin: WEEKDAY_HEADWAY_MIN,
				lastBusMinute: LAST_BUS_MINUTE,
			},
		]);
	});
});

describe("parseGbisRouteList", () => {
	it("노선 ID와 이름을 문자열로, 지역은 첫 시·군으로 읽는다", () => {
		const result = parseGbisRouteList(fixture("gbis-route-list-11.json"));
		if (!result.ok) {
			throw new Error("ok여야 한다");
		}
		const [first] = result.items;
		expect(first).toEqual({
			areaName: "구리",
			cityCode: null,
			name: "11",
			routeId: "236000050",
			routeTypeCode: "11",
		});
		expect(result.items.every((row) => typeof row.name === "string")).toBe(
			true
		);
	});
});

describe("GBIS 실패 봉투", () => {
	it("한도 초과는 quota다", () => {
		expect(parseGbisRouteList(errorFixture("gbis-error-quota.json"))).toEqual({
			ok: false,
			reason: "quota",
		});
	});

	it("인증 실패는 auth다", () => {
		expect(parseGbisRouteList(errorFixture("tago-error-auth.json"))).toEqual({
			ok: false,
			reason: "auth",
		});
	});

	it("결과 없음(resultCode 4)과 빈 목록은 no-data다", () => {
		const noData = { response: { msgHeader: { resultCode: 4 } } };
		const empty = {
			response: { msgBody: { busRouteList: [] }, msgHeader: { resultCode: 0 } },
		};
		expect(parseGbisRouteList(noData)).toEqual({
			ok: false,
			reason: "no-data",
		});
		expect(parseGbisRouteList(empty)).toEqual({ ok: false, reason: "no-data" });
	});

	it("시스템 에러는 temporary, 모양이 다르면 malformed다", () => {
		const system = { response: { msgHeader: { resultCode: 1 } } };
		expect(parseGbisRouteList(system)).toEqual({
			ok: false,
			reason: "temporary",
		});
		expect(parseGbisRouteList("x")).toEqual({ ok: false, reason: "malformed" });
		expect(parseGbisRouteStations({ response: {} })).toEqual({
			ok: false,
			reason: "malformed",
		});
	});

	it("항목이 하나여도 배열로 감싼다", () => {
		const single = {
			response: {
				msgBody: {
					busRouteList: {
						regionName: "수원",
						routeId: 1,
						routeName: "A",
						routeTypeCd: 13,
					},
				},
				msgHeader: { resultCode: 0 },
			},
		};
		const result = parseGbisRouteList(single);
		expect(result.ok && result.items).toHaveLength(1);
	});
});

describe("gbisUrl", () => {
	it("maskKey로 가리면 키가 남지 않는다", () => {
		const key = "abc+/def==secret";
		const url = gbisUrl("getBusRouteListv2", { keyword: "11" }, key);
		expect(url).toContain("getBusRouteListv2");
		expect(url).toContain("keyword=11");
		expect(url).toContain("format=json");
		const masked = maskKey(url, key);
		expect(masked).not.toContain("secret");
		expect(masked).not.toContain(encodeURIComponent(key));
	});
});

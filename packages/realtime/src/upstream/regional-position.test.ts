import { describe, expect, it } from "bun:test";
import gbisLocation from "../__fixtures__/regional/gbis-location.json";
import tagoGateway04 from "../__fixtures__/regional/tago-gateway-04.json";
import tagoLocation from "../__fixtures__/regional/tago-location.json";
import {
	gbisPositionUrl,
	parseRegionalPositions,
	tagoPositionUrl,
} from "./regional-position";

const gateway = (code: string) =>
	JSON.stringify({
		OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: code } },
	});

describe("지역 위치 파서", () => {
	it("GBIS 위치 목록은 좌표 없이 순번만 담는다", () => {
		const r = parseRegionalPositions("gbis", 200, gbisLocation.body);
		expect(r.outcome).toBe("ok");
		expect(r.rows).toHaveLength(15);
		expect(r.rows[0]).toMatchObject({
			lat: null,
			lng: null,
			plate: "경기70바2335",
			seq: 3,
			vehId: "200011171",
		});
	});

	it("TAGO 위치 목록은 좌표를 숫자로 읽는다", () => {
		const r = parseRegionalPositions("tago", 200, tagoLocation.body);
		expect(r.outcome).toBe("ok");
		expect(r.rows[0]).toMatchObject({
			lat: 37.432_504,
			lng: 126.614_102,
			seq: 3,
			vehId: "인천71바6272",
		});
	});

	it("TAGO 좌표가 문자열이어도 숫자로 바꾼다", () => {
		const body = JSON.stringify({
			response: {
				body: {
					items: {
						item: {
							gpslati: "37.5",
							gpslong: "127.1",
							nodeord: 4,
							vehicleno: "A1",
						},
					},
				},
				header: { resultCode: "00" },
			},
		});
		const r = parseRegionalPositions("tago", 200, body);
		expect(r.rows).toEqual([
			{ lat: 37.5, lng: 127.1, plate: "A1", seq: 4, vehId: "A1" },
		]);
	});

	it("게이트웨이 04는 temporary, 22는 quota-exhausted, 23은 rate-limited, 30은 auth다", () => {
		expect(
			parseRegionalPositions("tago", 200, tagoGateway04.body).outcome
		).toBe("temporary");
		expect(parseRegionalPositions("tago", 200, gateway("22")).outcome).toBe(
			"quota-exhausted"
		);
		expect(parseRegionalPositions("gbis", 200, gateway("23")).outcome).toBe(
			"rate-limited"
		);
		expect(parseRegionalPositions("tago", 200, gateway("30")).outcome).toBe(
			"auth"
		);
	});

	it("XML 게이트웨이 오류 본문도 returnReasonCode로 분류한다", () => {
		const xml = (code: string) =>
			`<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
		expect(parseRegionalPositions("gbis", 200, xml("22")).outcome).toBe(
			"quota-exhausted"
		);
		expect(parseRegionalPositions("gbis", 200, xml("30")).outcome).toBe("auth");
		expect(parseRegionalPositions("tago", 200, xml("04")).outcome).toBe(
			"temporary"
		);
	});

	it("HTTP 429는 quota-exhausted, 401은 auth, 5xx는 temporary다", () => {
		expect(parseRegionalPositions("gbis", 429, "").outcome).toBe(
			"quota-exhausted"
		);
		expect(parseRegionalPositions("gbis", 401, "").outcome).toBe("auth");
		expect(parseRegionalPositions("tago", 502, "").outcome).toBe("temporary");
	});

	it("빈 items와 GBIS resultCode 4는 no-data다", () => {
		const empty = JSON.stringify({
			response: { body: { items: "" }, header: { resultCode: "00" } },
		});
		expect(parseRegionalPositions("tago", 200, empty).outcome).toBe("no-data");
		const gbis4 = JSON.stringify({
			response: { msgHeader: { resultCode: 4 } },
		});
		expect(parseRegionalPositions("gbis", 200, gbis4).outcome).toBe("no-data");
	});

	it("모양이 다르면 malformed다", () => {
		expect(parseRegionalPositions("gbis", 200, "not json").outcome).toBe(
			"malformed"
		);
		expect(parseRegionalPositions("tago", 200, "{}").outcome).toBe("malformed");
	});

	it("주소는 https이고 키는 serviceKey로만 들어간다", () => {
		for (const url of [
			gbisPositionUrl("K/ey", "200000037"),
			tagoPositionUrl("K/ey", "23", "ICB361000005"),
		]) {
			expect(url.startsWith("https://apis.data.go.kr/")).toBe(true);
			expect(url).toContain("serviceKey=K%2Fey");
			expect(url.split("K/ey")).toHaveLength(1);
		}
	});
});

import { describe, expect, it } from "bun:test";
import gbisArrivalBoard from "./__fixtures__/regional/gbis-arrival-board.json";
import gbisLocation from "./__fixtures__/regional/gbis-location.json";
import tagoArrivalBoard from "./__fixtures__/regional/tago-arrival-board.json";
import tagoGateway04 from "./__fixtures__/regional/tago-gateway-04.json";
import tagoLocation from "./__fixtures__/regional/tago-location.json";
import {
	gbisArrivalUrl,
	gbisLocationUrl,
	matchTagoVehicles,
	parseGbisArrival,
	parseGbisLocations,
	parseTagoArrival,
	parseTagoLocations,
	type RegionalResult,
	tagoArrivalUrl,
	tagoLocationUrl,
} from "./regional-bus";

const AT = 1_700_000_000_000;

function body(fixture: { body: string }): unknown {
	return JSON.parse(fixture.body);
}

function ok<T>(result: RegionalResult<T>): T {
	if (!result.ok) {
		throw new Error(`파싱 실패: ${result.reason}`);
	}
	return result.value;
}

function gateway(code: string): unknown {
	return {
		OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: code } },
	};
}

describe("지역 버스 파서", () => {
	it("GBIS 도착의 차량 순번은 staOrder − locationNo이고 위치 목록과 같다", () => {
		const arrival = ok(
			parseGbisArrival(
				body(gbisArrivalBoard),
				{ seq: 15, stopId: "202000224" },
				AT
			)
		);
		expect(
			arrival.vehicles.map((v) => [v.vehicleId, v.seqNow, v.etaSec])
		).toEqual([
			["200011170", 12, 491],
			["200010795", 8, 734],
		]);
		const positions = ok(parseGbisLocations(body(gbisLocation)));
		expect(positions.find((p) => p.vehicleId === "200011170")?.seq).toBe(12);
	});

	it("TAGO 도착은 차이 2 이하의 가장 가까운 위치 차량 번호를 붙이고, 없으면 tago-pos다", () => {
		const arrival = ok(
			parseTagoArrival(
				body(tagoArrivalBoard),
				{ seq: 15, stopId: "ICB364000528" },
				AT
			)
		);
		const matched = matchTagoVehicles(
			arrival,
			ok(parseTagoLocations(body(tagoLocation)))
		);
		expect(matched.vehicles.map((v) => [v.seqNow, v.vehicleId])).toEqual([
			[13, "tago-pos:13"],
			[3, "인천71바6272"],
		]);
	});

	it("TAGO 게이트웨이 04는 temporary, 22는 quota, 30은 auth다", () => {
		expect(parseTagoLocations(body(tagoGateway04))).toEqual({
			ok: false,
			reason: "temporary",
		});
		expect(parseTagoLocations(gateway("22"))).toEqual({
			ok: false,
			reason: "quota",
		});
		expect(parseTagoLocations(gateway("30"))).toEqual({
			ok: false,
			reason: "auth",
		});
	});

	it("빈 TAGO 응답과 GBIS 결과 없음은 no-data이고 모양이 다르면 malformed다", () => {
		const empty = {
			response: {
				body: { items: "" },
				header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
			},
		};
		expect(parseTagoLocations(empty)).toEqual({ ok: false, reason: "no-data" });
		const none = { response: { msgHeader: { resultCode: 4 } } };
		expect(parseGbisLocations(none)).toEqual({ ok: false, reason: "no-data" });
		expect(parseGbisLocations({ foo: 1 })).toEqual({
			ok: false,
			reason: "malformed",
		});
	});

	it("GBIS resultCode 1은 temporary다", () => {
		const env = (resultCode: unknown) => ({
			response: { msgHeader: { resultCode } },
		});
		expect(parseGbisLocations(env(1))).toEqual({
			ok: false,
			reason: "temporary",
		});
		expect(parseGbisLocations(env("1"))).toEqual({
			ok: false,
			reason: "temporary",
		});
	});

	it("GBIS resultCode가 빈 문자열이나 null이나 숫자가 아니면 정상이 아니라 malformed다", () => {
		const env = (resultCode: unknown) => ({
			response: { msgHeader: { resultCode } },
		});
		for (const code of ["", null, "abc"]) {
			expect(parseGbisLocations(env(code))).toEqual({
				ok: false,
				reason: "malformed",
			});
		}
	});

	it("TAGO resultCode 99는 temporary이고 코드가 없으면 malformed다", () => {
		const env = (header: unknown) => ({ response: { header } });
		expect(parseTagoLocations(env({ resultCode: "99" }))).toEqual({
			ok: false,
			reason: "temporary",
		});
		expect(parseTagoLocations(env({}))).toEqual({
			ok: false,
			reason: "malformed",
		});
	});

	it("주소는 https이고 키는 serviceKey로만 들어간다", () => {
		const stop = { seq: 15, stopId: "S1" };
		const urls = [
			gbisArrivalUrl("KEY", "R1", stop),
			gbisLocationUrl("KEY", "R1"),
			tagoArrivalUrl("KEY", "23", "R1", stop),
			tagoLocationUrl("KEY", "23", "R1"),
		];
		for (const url of urls) {
			expect(url.startsWith("https://apis.data.go.kr/")).toBe(true);
			expect(url.match(/KEY/g)?.length).toBe(1);
			expect(url).toContain("serviceKey=KEY");
		}
	});
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	busRouteInfoUrl,
	fetchBusRouteOperation,
	maskKey,
	parseBusEnvelope,
	parseRoutePath,
	parseRouteStations,
} from "./seoul-bus-api";

function loadItems(name: string): Record<string, unknown>[] {
	const json = JSON.parse(
		readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")
	);
	return json.msgBody.itemList;
}

function envelope(headerCd: string, itemList?: unknown): string {
	return JSON.stringify({
		msgBody: { itemList },
		msgHeader: { headerCd, headerMsg: "msg", itemCount: 0 },
	});
}

describe("parseRouteStations", () => {
	it("parses the 6411 fixture", () => {
		const { rows, errors } = parseRouteStations(
			loadItems("bus-stations-6411.json")
		);
		expect(errors).toEqual([]);
		expect(rows).toHaveLength(117);
		expect(rows[0]).toMatchObject({
			apiSectDistM: 0,
			arsId: "15227",
			directionName: "선릉역",
			routeName: "6411",
			routeType: "4",
			seq: 1,
			stationId: "114000124",
		});
		expect(rows[116]?.apiSectDistM).toBe(386);
		expect(rows.map((row) => row.seq)).toEqual(
			Array.from({ length: 117 }, (_, index) => index + 1)
		);
	});

	it("reports bad numbers and drops the row", () => {
		const items = loadItems("bus-stations-6411.json").slice(0, 4);
		items[2] = { ...items[2], gpsX: "abc" };
		const { rows, errors } = parseRouteStations(items);
		expect(rows).toHaveLength(3);
		expect(errors).toEqual(["seq 3: invalid gpsX"]);
	});

	it("rejects JSON null and non-integer seq", () => {
		const items = loadItems("bus-stations-6411.json").slice(0, 4);
		items[2] = { ...items[2], gpsX: null };
		items[3] = { ...items[3], seq: "1.5" };
		const { rows, errors } = parseRouteStations(items);
		expect(rows).toHaveLength(2);
		expect(errors).toEqual(["seq 3: invalid gpsX", "seq 1.5: invalid seq"]);
	});
});

describe("parseRoutePath", () => {
	it("parses the 6411 fixture", () => {
		const { coords, errors } = parseRoutePath(loadItems("bus-path-6411.json"));
		expect(errors).toEqual([]);
		expect(coords).toHaveLength(1978);
		expect(coords[0]).toEqual([126.843_903, 37.509_44]);
	});

	it("sorts by no", () => {
		const { coords } = parseRoutePath([
			{ gpsX: "2", gpsY: "20", no: "2" },
			{ gpsX: "10", gpsY: "100", no: "10" },
			{ gpsX: "1", gpsY: "10", no: "1" },
		]);
		expect(coords).toEqual([
			[1, 10],
			[2, 20],
			[10, 100],
		]);
	});
});

describe("parseBusEnvelope", () => {
	it("401 is unauthorized", () => {
		expect(parseBusEnvelope(401, "{}").kind).toBe("unauthorized");
	});
	it("headerCd 7 is unauthorized", () => {
		expect(parseBusEnvelope(200, envelope("7")).kind).toBe("unauthorized");
	});
	it("429 is quota-exceeded", () => {
		expect(parseBusEnvelope(429, "").kind).toBe("quota-exceeded");
	});
	it("returnReasonCode 22 in XML is quota-exceeded", () => {
		const xml =
			"<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
		expect(parseBusEnvelope(200, xml).kind).toBe("quota-exceeded");
	});
	it("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS is quota-exceeded", () => {
		expect(
			parseBusEnvelope(200, "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR")
				.kind
		).toBe("quota-exceeded");
	});
	it("returnReasonCode 23 is rate-limited", () => {
		const xml = "<returnReasonCode>23</returnReasonCode>";
		expect(parseBusEnvelope(200, xml).kind).toBe("rate-limited");
	});
	it("headerCd 8 is rate-limited", () => {
		expect(parseBusEnvelope(200, envelope("8")).kind).toBe("rate-limited");
	});
	it("5xx and headerCd 6 are retryable", () => {
		expect(parseBusEnvelope(503, "oops").kind).toBe("retryable");
		expect(parseBusEnvelope(200, envelope("6")).kind).toBe("retryable");
		expect(parseBusEnvelope(200, envelope("1")).kind).toBe("retryable");
	});
	it("headerCd 4 is route-not-found", () => {
		expect(parseBusEnvelope(200, envelope("4")).kind).toBe("route-not-found");
	});
	it("headerCd 0 is ok with items", () => {
		const result = parseBusEnvelope(200, envelope("0", [{ seq: "1" }]));
		expect(result).toEqual({ items: [{ seq: "1" }], kind: "ok" });
	});
	it("headerCd 0 without itemList is ok and empty", () => {
		expect(parseBusEnvelope(200, envelope("0"))).toEqual({
			items: [],
			kind: "ok",
		});
	});
	it("HTML body is error", () => {
		const result = parseBusEnvelope(200, "<html>nope</html>");
		expect(result.kind).toBe("error");
	});
	it("unknown headerCd is error with detail", () => {
		const result = parseBusEnvelope(200, envelope("5"));
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.detail).toContain("5");
		}
	});
});

describe("parseRoutePath null", () => {
	it("rejects a null no", () => {
		const { coords, errors } = parseRoutePath([
			{ gpsX: "127.1", gpsY: "37.5", no: null },
		]);
		expect(coords).toEqual([]);
		expect(errors).toHaveLength(1);
	});
});

describe("maskKey", () => {
	it("hides raw and encoded key", () => {
		const key = "a/b+c==";
		const url = busRouteInfoUrl("getRoutePath", key, "100100290");
		expect(url).toContain(encodeURIComponent(key));
		const masked = maskKey(`${url} and ${key}`, key);
		expect(masked).not.toContain(key);
		expect(masked).not.toContain(encodeURIComponent(key));
		expect(masked).toContain("<key>");
	});
});

describe("fetchBusRouteOperation", () => {
	it("masks key in network errors", async () => {
		const key = "a/b+c==";
		const fetchImpl = ((url: string) => {
			throw new Error(`connect failed ${url}`);
		}) as unknown as typeof fetch;
		const result = await fetchBusRouteOperation({
			busRouteId: "1",
			fetchImpl,
			key,
			operation: "getStaionByRoute",
		});
		expect(result.envelope.kind).toBe("retryable");
		if (result.envelope.kind === "retryable") {
			expect(result.envelope.detail).not.toContain(key);
			expect(result.envelope.detail).not.toContain(encodeURIComponent(key));
		}
	});

	it("masks key echoed in the response body", async () => {
		const key = "a/b+c==";
		const body = `<html>bad request serviceKey=${encodeURIComponent(key)} raw ${key}</html>`;
		const fetchImpl = (() =>
			Promise.resolve(
				new Response(body, { status: 400 })
			)) as unknown as typeof fetch;
		const result = await fetchBusRouteOperation({
			busRouteId: "1",
			fetchImpl,
			key,
			operation: "getRoutePath",
		});
		expect(result.envelope.kind).toBe("error");
		if ("detail" in result.envelope) {
			expect(result.envelope.detail).not.toContain(key);
			expect(result.envelope.detail).not.toContain(encodeURIComponent(key));
			expect(result.envelope.detail).toContain("<key>");
		}
	});

	it("masks a key that crosses the 200 char cut", async () => {
		const key = "FAKEKEY1234567890abcdefghij==";
		const body = `${"x".repeat(185)}serviceKey=${encodeURIComponent(key)}`;
		const fetchImpl = (() =>
			Promise.resolve(
				new Response(body, { status: 400 })
			)) as unknown as typeof fetch;
		const result = await fetchBusRouteOperation({
			busRouteId: "1",
			fetchImpl,
			key,
			operation: "getRoutePath",
		});
		if (!("detail" in result.envelope)) {
			throw new Error("expected detail");
		}
		expect(result.envelope.detail).not.toContain(key.slice(0, 4));
	});

	it("non-2xx with headerCd 0 is error", () => {
		expect(parseBusEnvelope(403, envelope("0", [])).kind).toBe("error");
	});

	it("wraps a single itemList object", () => {
		const result = parseBusEnvelope(200, envelope("0", { seq: "1" }));
		expect(result.kind === "ok" && result.items.length).toBe(1);
	});

	it("rejects negative or fractional fullSectDist", () => {
		const base = { gpsX: "127", gpsY: "37", seq: "1", station: "1" };
		const { rows, errors } = parseRouteStations([
			{ ...base, fullSectDist: "-5" },
			{ ...base, fullSectDist: "1.5" },
		]);
		expect(rows).toHaveLength(0);
		expect(errors).toHaveLength(2);
	});

	it("reads a missing fullSectDist on the first stop as 0", () => {
		// 경기·인천 노선은 첫 정류소의 fullSectDist가 비어 온다(서울 노선은 "0").
		const base = { gpsX: "127", gpsY: "37", station: "1" };
		const { rows, errors } = parseRouteStations([
			{ ...base, fullSectDist: null, seq: "1" },
			{ ...base, fullSectDist: "264", seq: "2" },
		]);
		expect(errors).toEqual([]);
		expect(rows.map((row) => row.apiSectDistM)).toEqual([0, 264]);
		expect(parseRouteStations([{ ...base, seq: "1" }]).rows).toHaveLength(1);
		expect(
			parseRouteStations([{ ...base, fullSectDist: "", seq: "1" }]).rows
		).toHaveLength(1);
	});

	it("still rejects a missing fullSectDist after the first stop", () => {
		const base = { gpsX: "127", gpsY: "37", station: "1" };
		const { rows, errors } = parseRouteStations([
			{ ...base, fullSectDist: null, seq: "2" },
			{ ...base, fullSectDist: "abc", seq: "1" },
		]);
		expect(rows).toHaveLength(0);
		expect(errors).toEqual([
			"seq 2: invalid fullSectDist",
			"seq 1: invalid fullSectDist",
		]);
	});

	it("returns parsed envelope and body text", async () => {
		const body = envelope("0", [{ seq: "1" }]);
		const fetchImpl = (() =>
			Promise.resolve(new Response(body))) as unknown as typeof fetch;
		const result = await fetchBusRouteOperation({
			busRouteId: "1",
			fetchImpl,
			key: "k",
			operation: "getRoutePath",
		});
		expect(result.bodyText).toBe(body);
		expect(result.envelope.kind).toBe("ok");
	});
});

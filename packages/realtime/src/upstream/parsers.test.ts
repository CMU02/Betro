import { describe, expect, it } from "bun:test";
import arrivalSample from "../__fixtures__/arrival-all-sample.json";
import bus150 from "../__fixtures__/bus-150.json";
import bus6411 from "../__fixtures__/bus-6411.json";
import { parseBusPositions } from "./bus-position";
import { classifyBus, classifySubway } from "./classify";
import { parseStationArrivalAll } from "./subway-arrival";

describe("upstream parsers", () => {
	it("parses the ALL sample", () => {
		const parsed = parseStationArrivalAll(arrivalSample);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			return;
		}
		expect(parsed.rows).toHaveLength(arrivalSample.realtimeArrivalList.length);
		expect(parsed.dropped).toBe(0);
		expect(new Set(parsed.rows.map((r) => r.arvlCd)).has("99")).toBe(true);
	});

	it("parses real bus fixtures", () => {
		for (const fixture of [bus6411, bus150]) {
			const parsed = parseBusPositions(fixture);
			expect(parsed.ok).toBe(true);
			if (parsed.ok) {
				expect(parsed.rows.length).toBe(fixture.msgBody.itemList.length);
			}
		}
	});

	it("converts bus km to m", () => {
		const [first] = bus6411.msgBody.itemList;
		const json = {
			msgBody: {
				itemList: [{ ...first, fullSectDist: "0.601", sectDist: "0.213" }],
			},
			msgHeader: { headerCd: "0", headerMsg: "ok" },
		};
		const parsed = parseBusPositions(json);
		expect(parsed.ok && parsed.rows[0]?.sectDistM).toBe(213);
		expect(parsed.ok && parsed.rows[0]?.fullSectDistM).toBe(601);
	});

	it("treats a null itemList as empty", () => {
		const parsed = parseBusPositions({
			msgBody: { itemList: null },
			msgHeader: { headerCd: "0" },
		});
		expect(parsed).toEqual({ headerCd: "0", ok: true, rows: [] });
	});

	it("classifies outcomes", () => {
		const noData = parseStationArrivalAll({
			errorMessage: {
				code: "INFO-200",
				message: "해당하는 데이터가 없습니다.",
			},
		});
		expect(classifySubway(200, noData)).toBe("no-data");
		expect(classifySubway(null, null)).toBe("network");
		expect(classifySubway(401, null)).toBe("auth");
		const bus = (headerCd: string) =>
			parseBusPositions({
				msgBody: { itemList: null },
				msgHeader: { headerCd },
			});
		expect(classifyBus(200, bus("0"))).toBe("ok");
		expect(classifyBus(200, bus("4"))).toBe("no-data");
		expect(classifyBus(200, bus("8"))).toBe("service-ended");
		expect(classifyBus(200, bus("6"))).toBe("temporary");
		expect(classifyBus(401, null)).toBe("auth");
		expect(classifyBus(200, null, "22")).toBe("quota-exhausted");
		expect(classifyBus(200, null, "23")).toBe("rate-limited");
		expect(classifyBus(null, null)).toBe("network");
	});
});

import { describe, expect, it } from "bun:test";
import { busRouteXlsxUrl, parseBusRouteRows } from "./bus-route-xlsx";

const HEADER = [
	"ROUTE_ID",
	"노선명",
	"순번",
	"NODE_ID",
	"ARS_ID",
	"정류소명",
	"X좌표",
	"Y좌표",
];

describe("parseBusRouteRows", () => {
	it("groups rows by route", () => {
		const { routes, errors } = parseBusRouteRows([
			HEADER,
			[100_100_290, "6411", 1, 1, "1", "a", 126.9, 37.5],
			[100_100_026, "147", 1, 2, "2", "b", 126.9, 37.5],
			[100_100_026, "147", 2, 3, "3", "c", 126.9, 37.5],
		]);
		expect(errors).toEqual([]);
		expect(routes).toEqual([
			{ maxSeq: 2, routeId: "100100026", routeName: "147", stopCount: 2 },
			{ maxSeq: 1, routeId: "100100290", routeName: "6411", stopCount: 1 },
		]);
	});

	it("keeps the row count and the largest 순번 separately", () => {
		// OA-1095는 (가상)/(미정차) 행을 일부 빼지만 순번은 그대로 둔다.
		const { routes, errors } = parseBusRouteRows([
			HEADER,
			[100_100_290, "6411", 1, 1, "1", "a", 126.9, 37.5],
			[100_100_290, "6411", 2, 2, "2", "b", 126.9, 37.5],
			[100_100_290, "6411", 4, 4, "4", "d", 126.9, 37.5],
		]);
		expect(errors).toEqual([]);
		expect(routes).toEqual([
			{ maxSeq: 4, routeId: "100100290", routeName: "6411", stopCount: 3 },
		]);
	});

	it("rejects a blank or non-integer 순번 and does not count the row", () => {
		const { routes, errors } = parseBusRouteRows([
			HEADER,
			[100_100_290, "6411", 1, 1, "1", "a", 126.9, 37.5],
			[100_100_290, "6411", null, 2, "2", "b", 126.9, 37.5],
			[100_100_290, "6411", "2.5", 3, "3", "c", 126.9, 37.5],
		]);
		expect(errors).toEqual(["row 3: invalid 순번 ", "row 4: invalid 순번 2.5"]);
		expect(routes).toEqual([
			{ maxSeq: 1, routeId: "100100290", routeName: "6411", stopCount: 1 },
		]);
	});

	it("reports a missing ROUTE_ID header", () => {
		const { routes, errors } = parseBusRouteRows([
			["노선명", "순번"],
			["147", 1],
		]);
		expect(routes).toEqual([]);
		expect(errors.length).toBe(1);
		expect(errors[0]).toContain("ROUTE_ID");
	});
});

describe("busRouteXlsxUrl", () => {
	it("builds the OA-1095 download url", () => {
		expect(busRouteXlsxUrl(58)).toBe(
			"https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false&infId=OA-1095&seqNo=&seq=58&infSeq=2"
		);
	});
});

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
			{ routeId: "100100026", routeName: "147", stopCount: 2 },
			{ routeId: "100100290", routeName: "6411", stopCount: 1 },
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

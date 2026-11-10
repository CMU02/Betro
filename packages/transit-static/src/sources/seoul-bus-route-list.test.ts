import { describe, expect, it } from "bun:test";
import {
	mergeRouteLists,
	parseBusRouteList,
	ROUTE_LIST_SEARCH_TERMS,
} from "./seoul-bus-route-list";

describe("parseBusRouteList", () => {
	it("reads seoul, gyeonggi and incheon rows", () => {
		const rows = parseBusRouteList([
			{
				busRouteAbrv: "100",
				busRouteId: "100100118",
				busRouteNm: "100",
				routeType: "3",
			},
			{
				busRouteAbrv: "M5107",
				busRouteId: "234001243",
				busRouteNm: "M5107광주",
				routeType: "8",
			},
			{
				busRouteAbrv: "9",
				busRouteId: "222000001",
				busRouteNm: "9인천",
				routeType: "7",
			},
		]);
		expect(rows).toEqual([
			{
				busRouteId: "100100118",
				name: "100",
				routeType: "3",
				shortName: "100",
			},
			{
				busRouteId: "234001243",
				name: "M5107광주",
				routeType: "8",
				shortName: "M5107",
			},
			{
				busRouteId: "222000001",
				name: "9인천",
				routeType: "7",
				shortName: "9",
			},
		]);
	});

	it("falls back to the name when the abbreviation is empty", () => {
		const [row] = parseBusRouteList([
			{
				busRouteAbrv: "",
				busRouteId: "1",
				busRouteNm: "마을01",
				routeType: "2",
			},
		]);
		expect(row?.shortName).toBe("마을01");
	});
});

describe("mergeRouteLists", () => {
	it("keeps one row per busRouteId in id order", () => {
		const a = { busRouteId: "2", name: "b", routeType: "3", shortName: "b" };
		const b = { busRouteId: "1", name: "a", routeType: "3", shortName: "a" };
		expect(mergeRouteLists([[a, b], [a]])).toEqual([b, a]);
	});
});

describe("ROUTE_LIST_SEARCH_TERMS", () => {
	it("has digits, letters and hangul supplements", () => {
		expect(ROUTE_LIST_SEARCH_TERMS).toEqual([
			..."0123456789".split(""),
			"M",
			"N",
			"G",
			"A",
			"마을",
			"순환",
		]);
	});
});

import { describe, expect, it } from "bun:test";
import type { BusRouteListEntry } from "../sources/bus-route-xlsx";
import type { BusRouteListRow } from "../sources/seoul-bus-route-list";
import {
	AUTONOMOUS_PILOT_ROUTES,
	AUTONOMOUS_ROUTE_NAME,
	isInScopeRoute,
	isInScopeRouteType,
	isMapObservedRouteType,
	OUT_OF_SCOPE_ROUTE_IDS,
	OUT_OF_SCOPE_ROUTE_TYPES,
	REGIONAL_ROUTE_TYPES,
	regionOf,
	withRegionalRoutes,
} from "./scope";

describe("isInScopeRouteType", () => {
	it("keeps Seoul city, village, Incheon and Gyeonggi types and drops airport, retired, shuttle, ferry", () => {
		for (const routeType of ["2", "3", "4", "5", "6", "7", "8", "15"]) {
			expect(isInScopeRouteType(routeType)).toBe(true);
		}
		for (const routeType of ["1", "9", "10", "14"]) {
			expect(isInScopeRouteType(routeType)).toBe(false);
		}
		expect(OUT_OF_SCOPE_ROUTE_TYPES).toEqual(["1", "9", "10", "14"]);
	});

	it("trims surrounding whitespace before comparing", () => {
		expect(isInScopeRouteType(" 14 ")).toBe(false);
		expect(isInScopeRouteType(" 2 ")).toBe(true);
	});
});

describe("regionOf", () => {
	it("maps 8 to Gyeonggi, 7 to Incheon and everything else to Seoul", () => {
		expect(regionOf("8")).toBe("gyeonggi");
		expect(regionOf("7")).toBe("incheon");
		expect(regionOf("4")).toBe("seoul");
		expect(regionOf("2")).toBe("seoul");
		expect(regionOf(" 8 ")).toBe("gyeonggi");
		expect(REGIONAL_ROUTE_TYPES).toEqual(["7", "8"]);
	});
});

describe("isMapObservedRouteType", () => {
	it("leaves Incheon and Gyeonggi routes out of map observation", () => {
		expect(isMapObservedRouteType("7")).toBe(false);
		expect(isMapObservedRouteType("8")).toBe(false);
		expect(isMapObservedRouteType("2")).toBe(true);
		expect(isMapObservedRouteType("4")).toBe(true);
	});
});

describe("withRegionalRoutes", () => {
	const xlsx: BusRouteListEntry[] = [
		{ maxSeq: 117, routeId: "100100290", routeName: "6411", stopCount: 117 },
		{ maxSeq: 30, routeId: "111900010", routeName: "강남01", stopCount: 30 },
	];
	const list: BusRouteListRow[] = [
		{
			busRouteId: "100100290",
			name: "6411",
			routeType: "4",
			shortName: "6411",
		},
		{
			busRouteId: "234001243",
			name: "M5107광주",
			routeType: "8",
			shortName: "M5107",
		},
		{
			busRouteId: "165000215",
			name: "M6450인천",
			routeType: "7",
			shortName: "M6450",
		},
		// 엑셀에 없는 서울 노선은 목록에서 더하지 않는다(엑셀이 서울 노선의 출처).
		{ busRouteId: "100100999", name: "999", routeType: "4", shortName: "999" },
	];

	it("adds Incheon and Gyeonggi routes from the list to the xlsx routes", () => {
		expect(withRegionalRoutes(xlsx, list)).toEqual([
			{
				maxSeq: 117,
				routeId: "100100290",
				routeName: "6411",
				shortName: "6411",
				stopCount: 117,
			},
			{ maxSeq: 30, routeId: "111900010", routeName: "강남01", stopCount: 30 },
			{
				routeId: "165000215",
				routeName: "M6450인천",
				routeType: "7",
				shortName: "M6450",
			},
			{
				routeId: "234001243",
				routeName: "M5107광주",
				routeType: "8",
				shortName: "M5107",
			},
		]);
	});

	it("keeps an xlsx route once when the list also has it as regional", () => {
		const merged = withRegionalRoutes(
			[{ maxSeq: 40, routeId: "234001243", routeName: "M5107", stopCount: 40 }],
			list
		);
		expect(merged.filter((e) => e.routeId === "234001243")).toEqual([
			{
				maxSeq: 40,
				routeId: "234001243",
				routeName: "M5107",
				shortName: "M5107",
				stopCount: 40,
			},
		]);
	});
});

describe("isInScopeRoute", () => {
	it("keeps autonomous pilot routes by default", () => {
		expect(isInScopeRoute("100000024", "3")).toBe(true);
		expect(isInScopeRoute("100000020", "5")).toBe(true);
		expect(isInScopeRoute("101000005", "15")).toBe(true);
	});

	it("drops listed IDs whatever their routeType when an exclusion list is given", () => {
		expect(isInScopeRoute("100000024", "3", AUTONOMOUS_PILOT_ROUTES)).toBe(
			false
		);
		expect(isInScopeRoute("100000020", "5", AUTONOMOUS_PILOT_ROUTES)).toBe(
			false
		);
		expect(isInScopeRoute("100100016", "3", AUTONOMOUS_PILOT_ROUTES)).toBe(
			true
		);
	});

	it("keeps regular routes, including A/B branches and trimmed IDs", () => {
		expect(isInScopeRoute("100100016", "3")).toBe(true);
		expect(isInScopeRoute("100100001", "5")).toBe(true);
		expect(isInScopeRoute(" 100100610 ", "15")).toBe(true);
	});

	it("still drops out-of-scope routeTypes", () => {
		expect(isInScopeRoute("100100290", "1")).toBe(false);
		expect(isInScopeRoute("100100290", " 14 ")).toBe(false);
	});

	it("excludes no route IDs and lists 11 autonomous pilots whose labels match the name pattern", () => {
		expect(OUT_OF_SCOPE_ROUTE_IDS.size).toBe(0);
		expect(AUTONOMOUS_PILOT_ROUTES.size).toBe(11);
		for (const label of AUTONOMOUS_PILOT_ROUTES.values()) {
			expect(label).toMatch(AUTONOMOUS_ROUTE_NAME);
		}
	});

	it("autonomous name pattern skips regular A/B and commute routes", () => {
		for (const name of ["110A고려대", "5522A난곡", "01A", "서울07출근"]) {
			expect(AUTONOMOUS_ROUTE_NAME.test(name)).toBe(false);
		}
	});
});

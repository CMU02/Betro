import { describe, expect, it } from "bun:test";
import {
	AUTONOMOUS_PILOT_ROUTES,
	AUTONOMOUS_ROUTE_NAME,
	isInScopeRoute,
	isInScopeRouteType,
	OUT_OF_SCOPE_ROUTE_IDS,
	OUT_OF_SCOPE_ROUTE_TYPES,
} from "./scope";

describe("isInScopeRouteType", () => {
	it("keeps Seoul city bus types and drops airport, village, Incheon, Gyeonggi, retired, shuttle, ferry", () => {
		expect(isInScopeRouteType("3")).toBe(true);
		expect(isInScopeRouteType("4")).toBe(true);
		expect(isInScopeRouteType("5")).toBe(true);
		expect(isInScopeRouteType("6")).toBe(true);
		expect(isInScopeRouteType("15")).toBe(true);
		expect(isInScopeRouteType("1")).toBe(false);
		expect(isInScopeRouteType("2")).toBe(false);
		expect(isInScopeRouteType("8")).toBe(false);
		expect(isInScopeRouteType("10")).toBe(false);
		expect(isInScopeRouteType("14")).toBe(false);
		expect(OUT_OF_SCOPE_ROUTE_TYPES).toEqual([
			"1",
			"2",
			"7",
			"8",
			"9",
			"10",
			"14",
		]);
	});

	it("trims surrounding whitespace before comparing", () => {
		expect(isInScopeRouteType(" 2 ")).toBe(false);
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
		expect(isInScopeRoute("100100290", "2")).toBe(false);
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

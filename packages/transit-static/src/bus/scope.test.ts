import { describe, expect, it } from "bun:test";
import { isInScopeRouteType, OUT_OF_SCOPE_ROUTE_TYPES } from "./scope";

describe("isInScopeRouteType", () => {
	it("keeps Seoul route types and drops village, Incheon, Gyeonggi, retired", () => {
		expect(isInScopeRouteType("3")).toBe(true);
		expect(isInScopeRouteType("4")).toBe(true);
		expect(isInScopeRouteType("15")).toBe(true);
		expect(isInScopeRouteType("2")).toBe(false);
		expect(isInScopeRouteType("8")).toBe(false);
		expect(OUT_OF_SCOPE_ROUTE_TYPES).toEqual(["2", "7", "8", "9"]);
	});

	it("trims surrounding whitespace before comparing", () => {
		expect(isInScopeRouteType(" 2 ")).toBe(false);
	});
});

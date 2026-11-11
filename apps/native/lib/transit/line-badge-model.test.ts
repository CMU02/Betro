import { describe, expect, it } from "bun:test";

import { TRANSIT_COLORS } from "@/theme/tokens";
import { type LineBadgeInput, lineBadgeModel } from "./line-badge-model";

function bus(
	routeType: string,
	region: "seoul" | "gyeonggi" | "incheon" = "seoul"
): LineBadgeInput {
	return { mode: "bus", name: "472", region, routeType };
}

describe("lineBadgeModel bus", () => {
	it.each([
		["1", "bus/airport"],
		["2", "bus/village"],
		["3", "bus/trunk"],
		["4", "bus/branch"],
		["5", "bus/circular"],
		["6", "bus/express"],
	])("routeType %s uses %s", (routeType, colorToken) => {
		const model = lineBadgeModel(bus(routeType));
		expect(model.colorToken).toBe(colorToken);
		expect(model.label).toBe("472");
		expect(model.regionKey).toBeNull();
	});

	it("routeType 7 is express with the Incheon label", () => {
		const model = lineBadgeModel(bus("7", "incheon"));
		expect(model.colorToken).toBe("bus/express");
		expect(model.regionKey).toBe("transit.region.incheon");
	});

	it("routeType 8 is express with the Gyeonggi label", () => {
		const model = lineBadgeModel(bus("8", "gyeonggi"));
		expect(model.colorToken).toBe("bus/express");
		expect(model.regionKey).toBe("transit.region.gyeonggi");
	});

	it("unknown routeType falls back to trunk", () => {
		const model = lineBadgeModel(bus("99"));
		expect(model.colorToken).toBe("bus/trunk");
		expect(model.regionKey).toBeNull();
	});

	it("shows the region label for non-Seoul routes of any type", () => {
		expect(lineBadgeModel(bus("3", "gyeonggi")).regionKey).toBe(
			"transit.region.gyeonggi"
		);
		expect(lineBadgeModel(bus("3", "incheon")).regionKey).toBe(
			"transit.region.incheon"
		);
	});

	it("never returns an empty label", () => {
		const model = lineBadgeModel({ ...bus("3"), name: "" });
		expect(model.label.length).toBeGreaterThan(0);
	});
});

describe("lineBadgeModel subway", () => {
	it("maps the line key and the subway id to the same color", () => {
		const byKey = lineBadgeModel({
			line: "seoul-subway:line2",
			mode: "subway",
			name: "2호선",
		});
		const byId = lineBadgeModel({
			line: "seoul-subway:1002",
			mode: "subway",
			name: "2호선",
		});
		expect(byKey.colorToken).toBe("line/2");
		expect(byId.colorToken).toBe("line/2");
		expect(byKey.label).toBe("2호선");
		expect(byKey.regionKey).toBeNull();
	});

	it("maps named lines", () => {
		const model = lineBadgeModel({
			line: "seoul-subway:1077",
			mode: "subway",
			name: "신분당선",
		});
		expect(model.colorToken).toBe("line/sinbundang");
	});

	it("falls back to a real token for an unknown line and keeps the name", () => {
		const model = lineBadgeModel({
			line: "seoul-subway:nope",
			mode: "subway",
			name: "새 노선",
		});
		expect(model.colorToken in TRANSIT_COLORS).toBe(true);
		expect(model.label).toBe("새 노선");
	});

	it("only returns tokens that exist", () => {
		for (const routeType of ["1", "2", "3", "4", "5", "6", "7", "8", "x"]) {
			expect(lineBadgeModel(bus(routeType)).colorToken in TRANSIT_COLORS).toBe(
				true
			);
		}
	});
});

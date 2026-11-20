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

	it("Seoul night buses (routeType 15) keep the default color, not GBIS 15", () => {
		const model = lineBadgeModel({ ...bus("15"), name: "N26" });
		expect(model.colorToken).toBe("bus/trunk");
		expect(model.label).toBe("N26");
		expect(model.regionKey).toBeNull();
	});

	it("Seoul routeType 14 keeps the default color, not GBIS 14", () => {
		expect(lineBadgeModel(bus("14")).colorToken).toBe("bus/trunk");
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

	it.each([
		["seoul-subway:1093", "서해선"],
		["seoul-subway:1081", "경강선"],
		["seoul-subway:1094", "신림선"],
		["seoul-subway:nope", "새 노선"],
	])("%s has no transit token, so it is neutral (null)", (line, name) => {
		const model = lineBadgeModel({ line, mode: "subway", name });
		expect(model.colorToken).toBeNull();
		expect(model.label).toBe(name);
		expect(model.regionKey).toBeNull();
	});

	it.each([
		["line2", "line/2"],
		["1002", "line/2"],
	])("reads %s without a source prefix as the line key", (line, colorToken) => {
		expect(
			lineBadgeModel({ line, mode: "subway", name: "2호선" }).colorToken
		).toBe(colorToken);
	});

	it.each(["", "seoul-subway:", "unknown:1002"])(
		"draws %p as neutral instead of throwing",
		(line) => {
			const model = lineBadgeModel({ line, mode: "subway", name: "2호선" });
			expect(model.colorToken).toBeNull();
			expect(model.label).toBe("2호선");
		}
	);

	it("only returns tokens that exist", () => {
		for (const routeType of ["1", "2", "3", "4", "5", "6", "7", "8", "x"]) {
			expect(lineBadgeModel(bus(routeType)).colorToken in TRANSIT_COLORS).toBe(
				true
			);
		}
	});
});

describe("lineBadgeModel regional bus", () => {
	it.each([
		["30", "bus/village"],
		["11", "bus/express"],
		["14", "bus/express"],
		["13", "bus/branch"],
		["16", "bus/circular"],
	])(
		"GBIS code %s uses %s with the Gyeonggi label",
		(routeType, colorToken) => {
			const model = lineBadgeModel(bus(routeType, "gyeonggi"));
			expect(model.colorToken).toBe(colorToken);
			expect(model.regionKey).toBe("transit.region.gyeonggi");
		}
	);

	it("TAGO village type keeps the village color with the Incheon label", () => {
		const model = lineBadgeModel(bus("마을버스", "incheon"));
		expect(model.colorToken).toBe("bus/village");
		expect(model.regionKey).toBe("transit.region.incheon");
	});

	it("TAGO trunk and express types use their own colors", () => {
		expect(lineBadgeModel(bus("간선버스", "incheon")).colorToken).toBe(
			"bus/trunk"
		);
		expect(lineBadgeModel(bus("광역버스", "incheon")).colorToken).toBe(
			"bus/express"
		);
	});
});

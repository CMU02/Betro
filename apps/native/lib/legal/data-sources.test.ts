import { describe, expect, it } from "bun:test";

import {
	DATA_PROVIDERS,
	DATA_SOURCES_FOOTNOTE,
	STATUS_LEGEND,
} from "./data-sources";

describe("data sources", () => {
	it("credits OpenStreetMap under ODbL and every public data provider", () => {
		expect(DATA_PROVIDERS.map((p) => p.title)).toEqual([
			"서울특별시",
			"공공데이터포털",
			"국가철도공단",
			"© OpenStreetMap contributors",
		]);
		expect(DATA_PROVIDERS[3]?.subtitle).toContain("ODbL");
		expect(DATA_PROVIDERS[3]?.url).toBe(
			"https://www.openstreetmap.org/copyright"
		);
		expect(DATA_SOURCES_FOOTNOTE).toContain("공공누리 제1유형");
	});

	it("explains all four position states", () => {
		expect(STATUS_LEGEND.map((s) => s.kind)).toEqual([
			"live",
			"estimated",
			"delayed",
			"ended",
		]);
	});
});

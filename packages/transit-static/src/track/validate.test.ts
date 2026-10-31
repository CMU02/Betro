import { describe, expect, it } from "bun:test";
import type { CrosswalkRow } from "../crosswalk/match";
import { matchOsmStops, validateShape } from "./validate";

const s = (statnId: string, distanceM: number, offsetM = 10) => ({
	distanceM,
	offsetM,
	statnId,
});

describe("validateShape", () => {
	it("passes a clean shape", () => {
		expect(
			validateShape({
				medianGapM: 1000,
				osmStopOrder: ["A", "B", "C"],
				stations: [s("A", 0), s("B", 1000), s("C", 2100)],
			})
		).toEqual([]);
	});
	it("errors when OSM stop order disagrees with projected order", () => {
		const issues = validateShape({
			medianGapM: 1000,
			osmStopOrder: ["A", "C", "B"],
			stations: [s("A", 0), s("B", 1000), s("C", 2100)],
		});
		expect(
			issues.some((i) => i.code === "stop-order" && i.level === "error")
		).toBe(true);
	});
	it("warns on large offsets and odd gaps", () => {
		const issues = validateShape({
			medianGapM: 1000,
			osmStopOrder: [],
			stations: [s("A", 0, 120), s("B", 100), s("C", 5000)],
		});
		expect(issues.map((i) => i.code).sort()).toEqual([
			"long-gap",
			"short-gap",
			"station-offset",
		]);
		expect(issues.every((i) => i.level === "warn")).toBe(true);
	});
	it("errors with fewer than two stations", () => {
		expect(
			validateShape({
				medianGapM: 0,
				osmStopOrder: [],
				stations: [s("A", 0)],
			})[0]?.code
		).toBe("no-stations");
	});
});

describe("matchOsmStops", () => {
	const cand = (
		statnId: string,
		nameCanonical: string,
		frCode?: string,
		aliases: string[] = []
	) =>
		({ frCode, nameAliases: aliases, nameCanonical, statnId }) as CrosswalkRow;
	it("prefers ref = frCode, then normalized name, then aliases", () => {
		const r = matchOsmStops(
			[
				{
					id: 1,
					lat: 0,
					lon: 0,
					tags: { name: "엉뚱", ref: "S401" },
					type: "node",
				},
				{ id: 2, lat: 0, lon: 0, tags: { name: "서울역" }, type: "node" },
				{ id: 3, lat: 0, lon: 0, tags: { name: "원곡" }, type: "node" },
				{ id: 4, lat: 0, lon: 0, tags: { name: "모름" }, type: "node" },
			],
			[
				cand("1", "샛강", "S401"),
				cand("2", "서울"),
				cand("3", "시우", undefined, ["원곡"]),
			]
		);
		expect(r).toEqual([
			{ osmNodeId: 1, statnId: "1" },
			{ osmNodeId: 2, statnId: "2" },
			{ osmNodeId: 3, statnId: "3" },
		]);
	});
});

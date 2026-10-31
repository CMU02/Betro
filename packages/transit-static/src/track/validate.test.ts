import { describe, expect, it } from "bun:test";
import type { CrosswalkRow } from "../crosswalk/match";
import type { OsmNode } from "./osm-model";
import { matchOsmStops, stopRefConflicts, validateShape } from "./validate";

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
	it("warns on odd gaps and leaves offsets to station placement", () => {
		const issues = validateShape({
			medianGapM: 1000,
			osmStopOrder: [],
			stations: [s("A", 0, 120), s("B", 100), s("C", 5000)],
		});
		expect(issues.map((i) => i.code).sort()).toEqual(["long-gap", "short-gap"]);
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
	it("uses normalized name or alias first and falls back to ref = frCode", () => {
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
	const node = (id: number, name: string, ref?: string): OsmNode => ({
		id,
		lat: 0,
		lon: 0,
		tags: ref ? { name, ref } : { name },
		type: "node",
	});
	it("prefers a name match over a ref match on the same node", () => {
		const r = matchOsmStops(
			[node(1, "서울역", "S401")],
			[cand("1", "샛강", "S401"), cand("2", "서울", "S402")]
		);
		expect(r).toEqual([{ osmNodeId: 1, statnId: "2" }]);
	});
	it("rejects a ref-only match when the node name is another station of the line", () => {
		const stops = [node(10, "모란", "826")];
		const candidates = [
			cand("SUJIN", "수진", "826"),
			cand("MORAN", "모란", "827"),
		];
		expect(matchOsmStops(stops, candidates)).toEqual([
			{ osmNodeId: 10, statnId: "MORAN" },
		]);
		const [conflict] = stopRefConflicts(stops, candidates);
		expect(conflict).toMatchObject({
			code: "stop-ref-conflict",
			level: "warn",
		});
		expect(conflict?.detail).toContain("node 10");
		expect(conflict?.detail).toContain("SUJIN");
		expect(conflict?.detail).toContain("MORAN");
	});
	it("flags a name match whose ref disagrees with the station frCode", () => {
		const stops = [node(11, "모란", "999"), node(12, "수진", "826")];
		const candidates = [
			cand("SUJIN", "수진", "826"),
			cand("MORAN", "모란", "827"),
		];
		expect(matchOsmStops(stops, candidates)).toEqual([
			{ osmNodeId: 11, statnId: "MORAN" },
			{ osmNodeId: 12, statnId: "SUJIN" },
		]);
		const conflicts = stopRefConflicts(stops, candidates);
		expect(conflicts.map((c) => c.code)).toEqual(["stop-ref-conflict"]);
		expect(conflicts[0]?.detail).toContain("node 11");
	});
	it("does not flag a ref when the station has no frCode or the node has no ref", () => {
		expect(
			stopRefConflicts(
				[node(13, "천호", "811"), node(14, "암사")],
				[cand("CH", "천호"), cand("AM", "암사", "810")]
			)
		).toEqual([]);
	});
	it("does not flag a multi-valued or zero-padded ref that contains the frCode", () => {
		expect(
			stopRefConflicts(
				[node(15, "중앙", "450;K252"), node(16, "양재", "D08")],
				[cand("JA", "중앙", "450"), cand("YJ", "양재", "D8")]
			)
		).toEqual([]);
	});
});

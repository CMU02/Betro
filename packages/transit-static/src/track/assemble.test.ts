import { describe, expect, it } from "bun:test";
import { assembleTracks } from "./assemble";
import { indexOsm } from "./osm-model";

const node = (id: number, lon: number, tags?: Record<string, string>) => ({
	id,
	lat: 37.5,
	lon,
	tags,
	type: "node",
});
const osm = indexOsm({
	elements: [
		node(1, 127.0, { name: "가", railway: "stop" }),
		node(2, 127.01),
		node(3, 127.02, { name: "나" }),
		node(4, 127.03, { name: "다" }),
		{ id: 10, nodes: [1, 2, 3], type: "way" },
		{ id: 11, nodes: [3, 4], type: "way" },
		{
			id: 100,
			members: [
				{ ref: 1, role: "stop", type: "node" },
				{ ref: 3, role: "stop", type: "node" },
				{ ref: 4, role: "stop", type: "node" },
				{ ref: 10, role: "", type: "way" },
				{ ref: 11, role: "", type: "way" },
			],
			tags: { route: "subway" },
			type: "relation",
		},
	],
});
const cw = (statnId: string, name: string, lng: number, lineKey = "line2") =>
	({
		bldnId: "",
		coordSource: "station-master",
		lat: 37.5,
		lineKey,
		lng,
		matchMethod: "auto-same-line",
		nameAliases: [name],
		nameCanonical: name,
		qualityFlags: [],
		statnId,
		subwayId: "1002",
	}) as never;
const route = {
	branchKey: "main",
	direction: "up",
	lineKey: "line2",
	osmRelationId: 100,
} as const;

describe("assembleTracks", () => {
	it("builds one shape with ordered stations and OSM stop ids", () => {
		const r = assembleTracks({
			crosswalk: [
				cw("A", "가", 127.0),
				cw("B", "나", 127.02),
				cw("C", "다", 127.03),
			],
			osm,
			routes: [route],
		});
		expect(r.ok).toBe(true);
		const [shape] = r.shapes;
		expect(shape?.coords.length).toBe(4);
		expect(shape?.lengthM).toBeCloseTo(2653, -2);
		expect(
			shape?.stations.map((s) => [s.statnId, s.seq, s.osmStopNodeId])
		).toEqual([
			["A", 0, 1],
			["B", 1, 3],
			["C", 2, 4],
		]);
		expect(shape?.attribution).toBe("© OpenStreetMap contributors (ODbL)");
	});
	it("reports a station of the line that lies on no shape", () => {
		const r = assembleTracks({
			crosswalk: [
				cw("A", "가", 127.0),
				cw("B", "나", 127.02),
				cw("Z", "먼역", 127.3),
			],
			osm,
			routes: [route],
		});
		expect(r.ok).toBe(false);
		expect(r.uncoveredStations[0]).toMatchObject({
			lineKey: "line2",
			statnId: "Z",
		});
	});
	it("records a stitch failure for a missing relation and keeps going", () => {
		const r = assembleTracks({
			crosswalk: [cw("A", "가", 127.0), cw("B", "나", 127.02)],
			osm,
			routes: [route, { ...route, direction: "down", osmRelationId: 999 }],
		});
		expect(r.shapes.length).toBe(1);
		expect(r.stitchFailures).toEqual([
			{ osmRelationId: 999, reason: "missing-relation" },
		]);
		expect(r.ok).toBe(false);
	});
	it("ignores stations of other lines", () => {
		const r = assembleTracks({
			crosswalk: [
				cw("A", "가", 127.0),
				cw("B", "나", 127.02),
				cw("X", "다", 127.03, "line3"),
			],
			osm,
			routes: [route],
		});
		expect(r.shapes[0]?.stations.map((s) => s.statnId)).toEqual(["A", "B"]);
		expect(r.uncoveredStations).toEqual([]);
	});
});

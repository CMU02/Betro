import { describe, expect, it } from "bun:test";
import { anchorCounts, assembleTracks } from "./assemble";
import { indexOsm } from "./osm-model";
import { lineLengthM } from "./project";

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
	it("records how each station was anchored and counts anchors in the report", () => {
		const r = assembleTracks({
			crosswalk: [
				cw("A", "가", 127.0),
				cw("B", "나", 127.02),
				cw("C", "다", 127.03),
				cw("D", "라", 127.01),
			],
			osm,
			routes: [route],
		});
		const [shape] = r.shapes;
		expect(shape?.stations.map((s) => [s.statnId, s.anchor])).toEqual([
			["A", "osm-stop"],
			["D", "station-master"],
			["B", "osm-stop"],
			["C", "osm-stop"],
		]);
		expect(shape && anchorCounts(shape)).toEqual({
			"osm-stop": 3,
			"osm-stop-projected": 0,
			"station-master": 1,
		});
		expect(r.markdown).toContain("| osm-stop | projected | master |");
		expect(r.markdown).toContain("## stop-anchor-rejected");
		expect(r.markdown).toContain("## stop-ref-conflict");
	});
});

// 2호선 본선처럼 닫힌 고리. 이음매는 노드 1, 첫 정차 노드(시청)는 이음매 바로 앞 노드 5.
const LOOP_LAT = 37.5;
const loopNode = (id: number, lon: number, lat: number, name?: string) => ({
	id,
	lat,
	lon,
	tags: name ? { name, railway: "stop" } : undefined,
	type: "node",
});
const loopOsm = indexOsm({
	elements: [
		loopNode(1, 127.0, LOOP_LAT, "을지로입구"),
		loopNode(2, 127.01, LOOP_LAT, "을지로3가"),
		loopNode(3, 127.01, LOOP_LAT + 0.01, "을지로4가"),
		loopNode(4, 127.0, LOOP_LAT + 0.01, "충정로"),
		loopNode(5, 127.0, LOOP_LAT + 0.004, "시청"),
		{ id: 20, nodes: [1, 2, 3], type: "way" },
		{ id: 21, nodes: [3, 4, 5, 1], type: "way" },
		{
			id: 200,
			members: [
				{ ref: 5, role: "stop", type: "node" },
				{ ref: 1, role: "stop", type: "node" },
				{ ref: 2, role: "stop", type: "node" },
				{ ref: 3, role: "stop", type: "node" },
				{ ref: 4, role: "stop", type: "node" },
				{ ref: 5, role: "stop", type: "node" },
				{ ref: 20, role: "", type: "way" },
				{ ref: 21, role: "", type: "way" },
			],
			tags: { route: "subway" },
			type: "relation",
		},
	],
});
const loopStation = (statnId: string, name: string, lng: number, lat: number) =>
	({ ...(cw(statnId, name, lng) as object), lat }) as never;

describe("assembleTracks on a closed loop", () => {
	it("starts the loop at its first stop so the seam does not break stop order", () => {
		const r = assembleTracks({
			crosswalk: [
				// 역사마스터 시청 좌표는 이음매 쪽으로 조금 어긋나 있다.
				loopStation("S0", "시청", 127.0, LOOP_LAT + 0.0042),
				loopStation("S1", "을지로입구", 127.0, LOOP_LAT),
				loopStation("S2", "을지로3가", 127.01, LOOP_LAT),
				loopStation("S3", "을지로4가", 127.01, LOOP_LAT + 0.01),
				loopStation("S4", "충정로", 127.0, LOOP_LAT + 0.01),
			],
			osm: loopOsm,
			routes: [{ ...route, osmRelationId: 200 }],
		});
		expect(r.issues.flatMap((i) => i.issues)).toEqual([]);
		expect(r.ok).toBe(true);
		const [shape] = r.shapes;
		expect(shape?.coords[0]).toEqual([127.0, LOOP_LAT + 0.004]);
		expect(shape?.coords.at(-1)).toEqual([127.0, LOOP_LAT + 0.004]);
		expect(shape?.lengthM).toBeCloseTo(
			lineLengthM([
				[127.0, LOOP_LAT],
				[127.01, LOOP_LAT],
				[127.01, LOOP_LAT + 0.01],
				[127.0, LOOP_LAT + 0.01],
				[127.0, LOOP_LAT],
			]),
			3
		);
		expect(shape?.stations.map((s) => s.statnId)).toEqual([
			"S0",
			"S1",
			"S2",
			"S3",
			"S4",
		]);
		expect(shape?.stations[0]).toMatchObject({
			anchor: "osm-stop",
			distanceM: 0,
		});
	});
});

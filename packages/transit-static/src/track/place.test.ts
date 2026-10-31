import { describe, expect, it } from "bun:test";
import type { CrosswalkRow } from "../crosswalk/match";
import { rotateToNode } from "./loop";
import type { OsmNode } from "./osm-model";
import { placeStations } from "./place";
import { lineLengthM } from "./project";
import type { LngLat } from "./stitch";
import { validateShape } from "./validate";

// 위도 37.5에서 경도 0.01도는 약 884m, 위도 0.001도는 약 111m
const LAT = 37.5;
const SEGMENT_M = 884;

const stop = (id: number, lon: number, lat: number, name: string): OsmNode => ({
	id,
	lat,
	lon,
	tags: { name },
	type: "node",
});
const station = (
	statnId: string,
	name: string,
	lng: number,
	lat: number
): CrosswalkRow => ({
	bldnId: "",
	coordSource: "station-master",
	lat,
	lineKey: "line2",
	lng,
	matchMethod: "auto-same-line",
	nameAliases: [],
	nameCanonical: name,
	qualityFlags: [],
	statnId,
	subwayId: "1002",
});

// 동쪽으로 곧게 뻗은 선. 노드 1~5, 약 3.5km
const straight: LngLat[] = [
	[127.0, LAT],
	[127.01, LAT],
	[127.02, LAT],
	[127.03, LAT],
	[127.04, LAT],
];
const straightIds = [1, 2, 3, 4, 5];

const place = (stops: OsmNode[], stations: CrosswalkRow[]) =>
	placeStations({
		closed: false,
		coords: straight,
		nodeIds: straightIds,
		stations,
		stops,
	});

describe("placeStations", () => {
	it("anchors on a stop node that lies on the line even when the master coordinate is 300 m away", () => {
		const r = place(
			[stop(2, 127.01, LAT, "가")],
			[station("A", "가", 127.01, LAT + 0.0027)]
		);
		const [a] = r.onShape;
		expect(a).toMatchObject({
			anchor: "osm-stop",
			osmStopNodeId: 2,
			statnId: "A",
		});
		expect(a?.distanceM).toBeCloseTo(lineLengthM(straight.slice(0, 2)), 6);
		expect(a?.offsetM).toBeCloseTo(300, -1);
		expect(r.issues).toEqual([
			expect.objectContaining({ code: "station-offset", level: "warn" }),
		]);
	});

	it("projects a stop node that sits beside the line", () => {
		const r = place(
			[stop(99, 127.02, LAT + 0.000_36, "나")],
			[station("B", "나", 127.02, LAT)]
		);
		const [b] = r.onShape;
		expect(b).toMatchObject({
			anchor: "osm-stop-projected",
			osmStopNodeId: 99,
			statnId: "B",
		});
		expect(b?.distanceM).toBeCloseTo(lineLengthM(straight.slice(0, 3)), -1);
		expect(b?.offsetM).toBeLessThan(1);
		expect(r.issues).toEqual([]);
	});

	it("rejects a stop anchor 3 km from the master coordinate and falls back to the master", () => {
		const r = place(
			[stop(1, 127.0, LAT, "다")],
			[station("C", "다", 127.035, LAT + 0.0005)]
		);
		const [c] = r.onShape;
		expect(c).toMatchObject({ anchor: "station-master", statnId: "C" });
		expect(c?.osmStopNodeId).toBeUndefined();
		expect(c?.distanceM).toBeCloseTo(lineLengthM(straight) * 0.875, -1);
		expect(r.issues.map((i) => [i.code, i.level])).toEqual([
			["stop-anchor-rejected", "warn"],
		]);
	});

	it("projects the master coordinate when the station has no stop node", () => {
		const r = place([], [station("D", "라", 127.03, LAT + 0.0009)]);
		const [d] = r.onShape;
		expect(d).toMatchObject({ anchor: "station-master", statnId: "D" });
		expect(d?.offsetM).toBeCloseTo(100, -1);
		expect(r.issues.map((i) => i.code)).toEqual(["station-offset"]);
		expect(r.offShape).toEqual([]);
	});

	it("leaves a station off the shape when nothing lands within 150 m", () => {
		const r = place([], [station("E", "마", 127.02, LAT + 0.0027)]);
		expect(r.onShape).toEqual([]);
		expect(r.offShape[0]?.statnId).toBe("E");
		expect(r.offShape[0]?.offsetM).toBeGreaterThan(150);
	});

	it("follows stop order through a node the line passes twice", () => {
		// 숫자 6 모양: X에서 출발해 P, Q, W를 돌아 X를 다시 지나 R로 나간다.
		const coords: LngLat[] = [
			[127.0, LAT],
			[127.01, LAT],
			[127.01, LAT + 0.01],
			[127.0, LAT + 0.01],
			[127.0, LAT],
			[126.99, LAT],
		];
		const nodeIds = [10, 11, 12, 13, 10, 14];
		const r = placeStations({
			closed: false,
			coords,
			nodeIds,
			stations: [
				station("X", "엑스", 127.0, LAT),
				station("P", "피", 127.01, LAT),
				station("Q", "큐", 127.01, LAT + 0.01),
				station("R", "알", 126.99, LAT),
			],
			stops: [
				stop(10, 127.0, LAT, "엑스"),
				stop(11, 127.01, LAT, "피"),
				stop(12, 127.01, LAT + 0.01, "큐"),
				stop(10, 127.0, LAT, "엑스"),
				stop(14, 126.99, LAT, "알"),
			],
		});
		const byId = new Map(r.onShape.map((s) => [s.statnId, s.distanceM]));
		const secondPassM = lineLengthM(coords.slice(0, 5));
		expect(byId.get("X")).toBe(0);
		expect(byId.get("R")).toBeGreaterThan(secondPassM);
		expect(r.onShape.map((s) => s.statnId)).toEqual(["X", "P", "Q", "R"]);
		expect(r.stopOrder).toEqual(["X", "P", "Q", "R"]);
		expect(r.onShape.every((s) => s.anchor === "osm-stop")).toBe(true);
	});

	it("starts a rotated loop at its first stop even when that stop sits just before the seam", () => {
		// 닫힌 고리. 이음매는 노드 1이고 첫 stop(시청)은 이음매 바로 앞 노드 5다.
		const coords: LngLat[] = [
			[127.0, LAT],
			[127.01, LAT],
			[127.01, LAT + 0.01],
			[127.0, LAT + 0.01],
			[127.0, LAT + 0.0002],
			[127.0, LAT],
		];
		const nodeIds = [1, 2, 3, 4, 5, 1];
		const stops = [
			stop(5, 127.0, LAT + 0.0002, "시청"),
			stop(1, 127.0, LAT, "을지로입구"),
			stop(2, 127.01, LAT, "을지로3가"),
			stop(3, 127.01, LAT + 0.01, "을지로4가"),
			stop(4, 127.0, LAT + 0.01, "충정로"),
			stop(5, 127.0, LAT + 0.0002, "시청"),
		];
		const rotated = rotateToNode(coords, nodeIds, 5);
		const r = placeStations({
			closed: true,
			coords: rotated.coords,
			nodeIds: rotated.nodeIds,
			stations: [
				// 역사마스터 시청 좌표는 이음매 쪽으로 조금 어긋나 있다.
				station("S0", "시청", 127.0, LAT + 0.0003),
				station("S1", "을지로입구", 127.0, LAT),
				station("S2", "을지로3가", 127.01, LAT),
				station("S3", "을지로4가", 127.01, LAT + 0.01),
				station("S4", "충정로", 127.0, LAT + 0.01),
			],
			stops,
		});
		const total = lineLengthM(rotated.coords);
		expect(r.onShape[0]).toMatchObject({ distanceM: 0, statnId: "S0" });
		expect(r.onShape.at(-1)?.statnId).toBe("S4");
		expect(r.onShape.at(-1)?.distanceM).toBeGreaterThan(total - 1200);
		const issues = validateShape({
			medianGapM: SEGMENT_M,
			osmStopOrder: r.stopOrder,
			stations: r.onShape,
		});
		expect(issues.filter((i) => i.code === "stop-order")).toEqual([]);
	});

	it("searches a closed line once more from its start for a stop behind the cursor", () => {
		const coords: LngLat[] = [
			[127.0, LAT],
			[127.01, LAT],
			[127.01, LAT + 0.01],
			[127.0, LAT + 0.01],
			[127.0, LAT],
		];
		const r = placeStations({
			closed: true,
			coords,
			nodeIds: [1, 2, 3, 4, 1],
			stations: [
				station("C", "씨", 127.01, LAT + 0.01),
				station("D", "디", 127.0, LAT + 0.01),
				station("B", "비", 127.01, LAT),
			],
			stops: [
				stop(3, 127.01, LAT + 0.01, "씨"),
				stop(4, 127.0, LAT + 0.01, "디"),
				stop(2, 127.01, LAT, "비"),
			],
		});
		const b = r.onShape.find((s) => s.statnId === "B");
		expect(b).toMatchObject({ anchor: "osm-stop", osmStopNodeId: 2 });
		expect(b?.distanceM).toBeCloseTo(SEGMENT_M, -1);
	});

	it("does not wrap around on an open line", () => {
		const r = place(
			[stop(3, 127.02, LAT, "씨"), stop(2, 127.01, LAT, "비")],
			[station("C", "씨", 127.02, LAT), station("B", "비", 127.01, LAT)]
		);
		const b = r.onShape.find((s) => s.statnId === "B");
		expect(b?.anchor).toBe("osm-stop-projected");
	});

	it("anchors a stop node by its name and flags a ref that points to another station", () => {
		// OSM ref가 한 칸 밀린 경우: 모란 노드(노드 1)의 ref가 수진의 frCode다.
		const r = place(
			[
				{ ...stop(1, 127.0, LAT, "모란"), tags: { name: "모란", ref: "826" } },
				stop(2, 127.01, LAT, "수진"),
			],
			[
				{ ...station("SUJIN", "수진", 127.01, LAT), frCode: "826" },
				{ ...station("MORAN", "모란", 127.0, LAT + 0.0003), frCode: "827" },
			]
		);
		expect(
			r.onShape.map((s) => [s.statnId, s.anchor, s.osmStopNodeId])
		).toEqual([
			["MORAN", "osm-stop", 1],
			["SUJIN", "osm-stop", 2],
		]);
		expect(r.issues.map((i) => i.code)).toEqual(["stop-ref-conflict"]);
	});

	it("lets a station whose ref-only node names another station fall through to its master coordinate", () => {
		const r = place(
			[{ ...stop(1, 127.0, LAT, "모란"), tags: { name: "모란", ref: "826" } }],
			[
				{ ...station("SUJIN", "수진", 127.01, LAT + 0.0002), frCode: "826" },
				{ ...station("MORAN", "모란", 127.0, LAT), frCode: "827" },
			]
		);
		expect(
			r.onShape.map((s) => [s.statnId, s.anchor, s.osmStopNodeId])
		).toEqual([
			["MORAN", "osm-stop", 1],
			["SUJIN", "station-master", undefined],
		]);
		expect(r.issues.map((i) => i.code)).toEqual(["stop-ref-conflict"]);
		expect(r.issues[0]?.detail).toContain("SUJIN");
	});

	it("keeps relation order between two matched nodes that are both near the station", () => {
		// 노드 77(승강장, 약 48m)이 relation에서 먼저 나오고, 노드 3(선 위, 약 44m)이 더 가깝다.
		const r = place(
			[stop(77, 127.0201, LAT + 0.0003, "다"), stop(3, 127.02, LAT, "다")],
			[station("C", "다", 127.0205, LAT)]
		);
		expect(r.onShape[0]).toMatchObject({
			anchor: "osm-stop-projected",
			osmStopNodeId: 77,
		});
		expect(r.issues.map((i) => i.code)).not.toContain("stop-anchor-rejected");
	});
});

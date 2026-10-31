import { describe, expect, it } from "bun:test";
import { indexOsm } from "./osm-model";
import { stitchWays } from "./stitch";

const node = (id: number, lon: number, lat = 37.5) => ({
	id,
	lat,
	lon,
	type: "node",
});
const way = (id: number, nodes: number[]) => ({ id, nodes, type: "way" });
const idx = indexOsm({
	elements: [
		node(1, 127.0),
		node(2, 127.01),
		node(3, 127.02),
		node(4, 127.03),
		node(9, 127.5),
		// 노드 4와 거의 같은 위치(1m 이내)에 있는 다른 노드
		node(5, 127.030_005),
		node(6, 127.04),
		way(10, [1, 2]),
		way(11, [2, 3]),
		way(12, [4, 3]),
		way(13, [9, 4]),
		way(20, [2, 1]),
		way(21, [5, 6]),
	],
});
const w = (id: number) => {
	const x = idx.ways.get(id);
	if (!x) {
		throw new Error(String(id));
	}
	return x;
};

describe("stitchWays", () => {
	it("joins ways end to start without duplicating the shared node", () => {
		const r = stitchWays([w(10), w(11)], idx);
		expect(r).toEqual({
			coords: [
				[127.0, 37.5],
				[127.01, 37.5],
				[127.02, 37.5],
			],
			nodeIds: [1, 2, 3],
			ok: true,
		});
	});
	it("returns node ids parallel to coords, following reversed ways", () => {
		const r = stitchWays([w(20), w(11), w(12)], idx);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.nodeIds).toEqual([1, 2, 3, 4]);
			expect(r.nodeIds.length).toBe(r.coords.length);
		}
	});
	it("keeps node ids aligned when a near-touching way drops its first point", () => {
		const r = stitchWays([w(10), w(11), w(12), w(21)], idx);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.nodeIds).toEqual([1, 2, 3, 4, 6]);
			expect(r.nodeIds.length).toBe(r.coords.length);
			expect(r.coords.at(-1)).toEqual([127.04, 37.5]);
		}
	});
	it("reverses a way whose end touches the current end", () => {
		const r = stitchWays([w(10), w(11), w(12)], idx);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.coords.at(-1)).toEqual([127.03, 37.5]);
		}
	});
	it("orients the first way toward the second", () => {
		const r = stitchWays([w(20), w(11)], idx);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.coords[0]).toEqual([127.0, 37.5]);
		}
	});
	it("reports a gap instead of jumping", () => {
		const r = stitchWays([w(10), w(13)], idx);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.reason).toBe("gap");
			expect(r.atWayId).toBe(13);
			expect(r.gapM).toBeGreaterThan(1000);
		}
	});
	it("handles an empty list", () => {
		expect(stitchWays([], idx)).toEqual({ ok: false, reason: "empty" });
	});
});

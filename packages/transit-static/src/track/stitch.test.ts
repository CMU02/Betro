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
		way(10, [1, 2]),
		way(11, [2, 3]),
		way(12, [4, 3]),
		way(13, [9, 4]),
		way(20, [2, 1]),
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
			ok: true,
		});
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

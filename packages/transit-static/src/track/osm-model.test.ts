import { describe, expect, it } from "bun:test";
import { indexOsm, stopNodesOf, wayMembersOf } from "./osm-model";

const json = {
	elements: [
		{
			id: 1,
			lat: 37.5,
			lon: 127.0,
			tags: { name: "가", railway: "stop" },
			type: "node",
		},
		{ id: 2, lat: 37.5, lon: 127.01, type: "node" },
		{ id: 3, lat: 37.5, lon: 127.02, tags: { name: "나" }, type: "node" },
		{ id: 10, nodes: [1, 2], type: "way" },
		{ id: 11, nodes: [2, 3], type: "way" },
		{
			id: 100,
			members: [
				{ ref: 1, role: "stop", type: "node" },
				{ ref: 3, role: "stop_exit_only", type: "node" },
				{ ref: 10, role: "", type: "way" },
				{ ref: 11, role: "", type: "way" },
				{ ref: 99, role: "", type: "way" },
				{ ref: 2, role: "platform", type: "node" },
			],
			tags: { route: "subway", type: "route" },
			type: "relation",
		},
	],
};

describe("indexOsm", () => {
	it("indexes by type and id", () => {
		const idx = indexOsm(json);
		expect(idx.nodes.size).toBe(3);
		expect(idx.ways.get(11)?.nodes).toEqual([2, 3]);
		expect(idx.relations.has(100)).toBe(true);
	});
	it("throws on a malformed payload", () => {
		expect(() => indexOsm({ nope: true })).toThrow();
	});
	it("stopNodesOf keeps member order and only stop roles", () => {
		const idx = indexOsm(json);
		const rel = idx.relations.get(100);
		if (!rel) {
			throw new Error("rel");
		}
		expect(stopNodesOf(rel, idx).map((n) => n.id)).toEqual([1, 3]);
	});
	it("wayMembersOf skips ways missing from the payload", () => {
		const idx = indexOsm(json);
		const rel = idx.relations.get(100);
		if (!rel) {
			throw new Error("rel");
		}
		expect(wayMembersOf(rel, idx).map((w) => w.id)).toEqual([10, 11]);
	});
});

import { describe, expect, it } from "bun:test";
import { isClosed, rotateToNode } from "./loop";
import { lineLengthM } from "./project";
import type { LngLat } from "./stitch";

const A: LngLat = [127.0, 37.5];
const B: LngLat = [127.01, 37.5];
const C: LngLat = [127.01, 37.51];
const D: LngLat = [127.0, 37.51];
const square: LngLat[] = [A, B, C, D, A];
const squareIds = [1, 2, 3, 4, 1];

describe("isClosed", () => {
	it("is true when the first and last node ids match", () => {
		expect(isClosed(square, squareIds)).toBe(true);
	});
	it("is true when only the first and last coordinates match", () => {
		expect(isClosed(square, [1, 2, 3, 4, 5])).toBe(true);
	});
	it("is false for an open line", () => {
		expect(isClosed([A, B, C], [1, 2, 3])).toBe(false);
	});
});

describe("rotateToNode", () => {
	it("starts the loop at the given node and keeps it closed with the same length", () => {
		const r = rotateToNode(square, squareIds, 3);
		expect(r.nodeIds).toEqual([3, 4, 1, 2, 3]);
		expect(r.coords).toEqual([C, D, A, B, C]);
		expect(lineLengthM(r.coords)).toBeCloseTo(lineLengthM(square), 6);
	});
	it("returns the input unchanged for a node not on the loop", () => {
		const r = rotateToNode(square, squareIds, 99);
		expect(r.nodeIds).toEqual(squareIds);
		expect(r.coords).toEqual(square);
	});
	it("returns the input unchanged for an open line", () => {
		const r = rotateToNode([A, B, C], [1, 2, 3], 2);
		expect(r.nodeIds).toEqual([1, 2, 3]);
		expect(r.coords).toEqual([A, B, C]);
	});
});

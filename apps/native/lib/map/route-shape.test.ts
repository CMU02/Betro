import { expect, it } from "bun:test";
import { cumulativeM } from "./motion";
import { regionOf, spanSegments, toCoords } from "./route-shape";

const LINE: [number, number][] = [
	[127, 37],
	[127.005, 37],
	[127.01, 37],
];

const total = () => cumulativeM(LINE).at(-1) ?? 0;

it("slices the board to alight span along the line including inner vertices", () => {
	const length = total();
	const [segment, ...rest] = spanSegments(LINE, length * 0.1, length * 0.9);
	expect(rest).toEqual([]);
	expect(segment).toHaveLength(3);
	expect(segment?.[0]?.[0]).toBeCloseTo(127.001, 5);
	expect(segment?.[1]).toEqual([127.005, 37]);
	expect(segment?.[2]?.[0]).toBeCloseTo(127.009, 5);
});

it("wraps a loop span whose alight comes before the board into two segments", () => {
	const length = total();
	const segments = spanSegments(LINE, length * 0.75, length * 0.25);
	expect(segments).toHaveLength(2);
	expect(segments[0]?.[0]?.[0]).toBeCloseTo(127.0075, 5);
	expect(segments[0]?.at(-1)).toEqual([127.01, 37]);
	expect(segments[1]?.[0]).toEqual([127, 37]);
	expect(segments[1]?.at(-1)?.[0]).toBeCloseTo(127.0025, 5);
});

it("draws no span when either end is unknown or the line is missing", () => {
	expect(spanSegments(LINE, null, 100)).toEqual([]);
	expect(spanSegments(LINE, 100, null)).toEqual([]);
	expect(spanSegments([], 0, 100)).toEqual([]);
	expect(spanSegments(LINE, 100, 100)).toEqual([]);
});

it("turns [lng, lat] pairs into map coordinates", () => {
	expect(toCoords([[127, 37]])).toEqual([{ latitude: 37, longitude: 127 }]);
});

it("region starts at the south-west corner and pads both deltas", () => {
	const region = regionOf(
		[
			[127, 37],
			[127.1, 37.2],
		],
		0.1
	);
	expect(region?.latitudeDelta).toBeCloseTo(0.24, 6);
	expect(region?.longitudeDelta).toBeCloseTo(0.12, 6);
	expect(region?.latitude).toBeCloseTo(36.98, 6);
	expect(region?.longitude).toBeCloseTo(126.99, 6);
});

it("region keeps a minimum size around a single point and is null without points", () => {
	const region = regionOf([[127, 37]], 0);
	expect(region?.latitudeDelta).toBeGreaterThan(0);
	expect(
		(region?.latitude ?? 0) + (region?.latitudeDelta ?? 0) / 2
	).toBeCloseTo(37, 6);
	expect(regionOf([], 0.1)).toBeNull();
});

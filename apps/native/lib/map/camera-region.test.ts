import { expect, it } from "bun:test";
import { nearestApproachingPoint } from "./camera-region";
import type { MotionState } from "./motion";
import type { MapLeg, RenderVehicle } from "./use-map-data";

const motionAt = (distanceM: number): MotionState => ({
	anchorAt: 0,
	catchUpM: 0,
	ceilingM: null,
	lastObservedAt: 0,
	observedDistanceM: distanceM,
	shownDistanceM: distanceM,
	speedMps: 0,
});

const vehicle = (id: string, distanceM: number, longitude: number) =>
	({
		id,
		latitude: 37,
		longitude,
		motion: motionAt(distanceM),
	}) as RenderVehicle;

/** 동쪽으로 1km쯤 되는 직선 노선. 승차는 800m 지점이다. */
const SHAPE: [number, number][] = [
	[127, 37],
	[127.0113, 37],
];

const leg = (overrides: Partial<MapLeg>): MapLeg =>
	({
		alightM: 1000,
		boardM: 800,
		showVehicles: true,
		track: { shape: SHAPE },
		vehicles: [],
		...overrides,
	}) as MapLeg;

it("picks the first leg's vehicle closest behind the boarding stop", () => {
	const point = nearestApproachingPoint([
		leg({
			vehicles: [vehicle("far", 100, 127.001), vehicle("near", 600, 127.006)],
		}),
		leg({ vehicles: [vehicle("second-leg", 790, 127.009)] }),
	]);
	expect(point).toEqual([127.006, 37]);
});

it("skips hidden or empty legs and returns null without vehicles", () => {
	expect(
		nearestApproachingPoint([
			leg({ showVehicles: false, vehicles: [vehicle("hidden", 700, 127.1)] }),
			leg({ vehicles: [] }),
		])
	).toBeNull();
	expect(nearestApproachingPoint([])).toBeNull();
});

it("counts a loop vehicle past the seam as behind the boarding stop", () => {
	// 순환선에서 승차가 100m이면 900m의 차량은 이음매를 넘어 약 200m 뒤, 400m의 차량은 약 700m 뒤다.
	const point = nearestApproachingPoint([
		leg({
			boardM: 100,
			vehicles: [
				vehicle("seam", 900, 127.009),
				vehicle("before-seam", 400, 127.004),
			],
		}),
	]);
	expect(point).toEqual([127.009, 37]);
});

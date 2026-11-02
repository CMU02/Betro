import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	type BusRouteStationRow,
	parseRoutePath,
	parseRouteStations,
} from "../sources/seoul-bus-api";
import { projectPoint } from "../track/project";
import { buildSegments, projectStopsForward } from "./project-stops";

const EARTH_RADIUS_M = 6_371_008.8;
const LAT0 = 37.5;
const LNG0 = 127.0;
const DEG = Math.PI / 180;
/** 나쁜 정류소 하나가 있어도 다른 정류소는 원래 거리에서 이 범위(미터) 안에 있어야 한다. */
const NEAR_ORIGINAL_M = 5;
const DISPLACED_M = 150;
/** 퍼즈: 정류소 하나를 옮길 거리(미터)와 방향(동, 북 단위 벡터). */
const FUZZ_DISTANCES_M = [100, 150, 300, 500] as const;
const FUZZ_DIRECTIONS = [
	[0, 1],
	[1, 0],
	[0, -1],
	[-1, 0],
] as const;
/** 퍼즈: 나쁜 정류소 하나 때문에 NEAR_ORIGINAL_M 넘게 움직여도 되는 다른 정류소 수. */
const MAX_DRAGGED_STOPS = 3;
const FUZZ_TIMEOUT_MS = 30_000;

function loadItems(name: string): Record<string, unknown>[] {
	const json = JSON.parse(
		readFileSync(
			new URL(`../sources/__fixtures__/${name}`, import.meta.url),
			"utf8"
		)
	);
	return json.msgBody.itemList;
}

function load6411(): {
	coords: [number, number][];
	stops: BusRouteStationRow[];
} {
	const { coords } = parseRoutePath(loadItems("bus-path-6411.json"));
	const { rows } = parseRouteStations(loadItems("bus-stations-6411.json"));
	return { coords, stops: rows.toSorted((a, b) => a.seq - b.seq) };
}

/** (LNG0, LAT0)에서 동쪽 x m, 북쪽 y m인 점 */
function at(xM: number, yM: number): [number, number] {
	return [
		LNG0 + xM / (EARTH_RADIUS_M * Math.cos(LAT0 * DEG) * DEG),
		LAT0 + yM / (EARTH_RADIUS_M * DEG),
	];
}

function stop(
	seq: number,
	[lng, lat]: [number, number],
	apiSectDistM: number
): BusRouteStationRow {
	return {
		apiSectDistM,
		arsId: null,
		directionName: null,
		lat,
		lng,
		name: `stop ${seq}`,
		routeName: "test",
		routeType: "4",
		seq,
		stationId: `S${seq}`,
	};
}

/** 6411에서 seq 하나의 좌표만 바꿔 투영하고, 원본 투영과 비교한다. */
function projectWithBadStop(
	badSeq: number,
	move: (row: BusRouteStationRow) => BusRouteStationRow
): {
	baseline: ReturnType<typeof projectStopsForward>;
	result: ReturnType<typeof projectStopsForward>;
	stops: BusRouteStationRow[];
} {
	const { coords, stops } = load6411();
	const baseline = projectStopsForward(coords, stops);
	const bad = stops.map((row) => (row.seq === badSeq ? move(row) : row));
	return { baseline, result: projectStopsForward(coords, bad), stops: bad };
}

/** 나쁜 정류소 하나가 뒤 정류소를 끌고 가지 않았는지 확인한다. */
function expectOnlyBadStopAffected(
	badSeq: number,
	{ baseline, result, stops }: ReturnType<typeof projectWithBadStop>
): void {
	const flagged = result.stops
		.filter((s) => s.flags.length > 0)
		.map((s) => s.seq);
	expect(flagged).toEqual([badSeq]);
	for (const [i, projected] of result.stops.entries()) {
		if (projected.seq === badSeq) {
			continue;
		}
		const original = baseline.stops[i]?.distanceM ?? Number.NaN;
		expect(Math.abs(projected.distanceM - original)).toBeLessThan(
			NEAR_ORIGINAL_M
		);
	}
	for (let i = 1; i < result.stops.length; i += 1) {
		expect(result.stops[i]?.distanceM ?? 0).toBeGreaterThanOrEqual(
			result.stops[i - 1]?.distanceM ?? 0
		);
	}
	const segments = buildSegments(stops, result.stops);
	const zeroLength = segments.filter((s) =>
		s.flags.includes("zero-length-segment")
	);
	expect(zeroLength.length).toBeLessThanOrEqual(1);
}

/** 정류소를 동쪽 eastM, 북쪽 northM만큼 옮긴다. */
function displace(
	row: BusRouteStationRow,
	eastM: number,
	northM: number
): BusRouteStationRow {
	return {
		...row,
		lat: row.lat + northM / (EARTH_RADIUS_M * DEG),
		lng: row.lng + eastM / (EARTH_RADIUS_M * Math.cos(row.lat * DEG) * DEG),
	};
}

/** 원본 투영보다 NEAR_ORIGINAL_M 넘게 움직인 정류소(badSeq 제외) 수. */
function countDragged(
	badSeq: number,
	baseline: readonly { distanceM: number }[],
	result: readonly { distanceM: number; seq: number }[]
): number {
	let dragged = 0;
	for (const [i, projected] of result.entries()) {
		const original = baseline[i]?.distanceM ?? Number.NaN;
		const moved = !(
			Math.abs(projected.distanceM - original) <= NEAR_ORIGINAL_M
		);
		if (projected.seq !== badSeq && moved) {
			dragged += 1;
		}
	}
	return dragged;
}

function median(values: number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
		: (sorted[mid] ?? 0);
}

describe("projectStopsForward", () => {
	it("projects 6411 stops monotonically", () => {
		const { coords, stops } = load6411();
		const result = projectStopsForward(coords, stops);
		expect(result.stops).toHaveLength(117);
		expect(result.stops.map((s) => s.seq)).toEqual(stops.map((s) => s.seq));
		for (let i = 1; i < result.stops.length; i += 1) {
			expect(result.stops[i]?.distanceM ?? 0).toBeGreaterThanOrEqual(
				result.stops[i - 1]?.distanceM ?? 0
			);
		}
		const maxOffset = Math.max(...result.stops.map((s) => s.offsetM));
		expect(maxOffset).toBeLessThan(30);
		const first = result.stops[0]?.distanceM ?? 0;
		expect(first).toBeGreaterThanOrEqual(500);
		expect(first).toBeLessThanOrEqual(750);
		const offShape = result.stops.filter((s) =>
			s.flags.includes("stop-off-shape")
		);
		expect(offShape).toHaveLength(0);
		expect(result.lengthM).toBeGreaterThan(first);
	});

	it("global nearest goes backwards on 6411", () => {
		// 전진 창이 필요한 이유: 같은 도로를 왕복하면 전역 최근접은 순서가 뒤로 간다.
		const { coords, stops } = load6411();
		const distances = stops.map(
			(s) => projectPoint(coords, [s.lng, s.lat]).distanceM
		);
		let backwardSteps = 0;
		for (let i = 1; i < distances.length; i += 1) {
			if ((distances[i] ?? 0) < (distances[i - 1] ?? 0)) {
				backwardSteps += 1;
			}
		}
		// 계획 실측값(Review Focus #1)과 같은 3번.
		expect(backwardSteps).toBe(3);
	});

	it("closed loop keeps last stop at the end", () => {
		const square = [
			at(0, 0),
			at(1000, 0),
			at(1000, 1000),
			at(0, 1000),
			at(0, 0),
		];
		const stops = [
			stop(1, at(0, 0), 0),
			stop(2, at(1000, 500), 1500),
			stop(3, at(500, 1000), 1000),
			stop(4, at(0, 500), 1000),
			stop(5, at(0, 0), 500),
		];
		const result = projectStopsForward(square, stops);
		expect(result.lengthM).toBeCloseTo(4000, -1);
		expect(result.stops[0]?.distanceM ?? -1).toBeCloseTo(0, 3);
		expect(result.stops[4]?.distanceM ?? 0).toBeGreaterThanOrEqual(
			result.lengthM - 1
		);
		const segments = buildSegments(stops, result.stops);
		for (const segment of segments) {
			expect(segment.endM - segment.startM).toBeGreaterThan(0);
		}
	});

	it("flags a stop far from the shape", () => {
		const line = [at(0, 0), at(2000, 0)];
		const stops = [stop(1, at(100, 0), 0), stop(2, at(800, 300), 700)];
		const result = projectStopsForward(line, stops);
		expect(result.stops[0]?.flags).toEqual([]);
		expect(result.stops[1]?.flags).toContain("stop-off-shape");
		expect(result.stops[1]?.offsetM ?? 0).toBeCloseTo(300, 0);
	});

	it("a stop displaced 150m does not drag later stops on 6411", () => {
		const badSeq = 50;
		const run = projectWithBadStop(badSeq, (row) => ({
			...row,
			lat: row.lat + DISPLACED_M / (EARTH_RADIUS_M * DEG),
		}));
		expectOnlyBadStopAffected(badSeq, run);
		const bad = run.result.stops.find((s) => s.seq === badSeq);
		expect(bad?.flags).toEqual(["stop-off-shape"]);
	});

	it("a stop at (0, 0) does not drag later stops on 6411", () => {
		// 서울 API는 좌표가 없을 때 0을 줄 수 있고 parseRouteStations는 이를 받아들인다.
		const badSeq = 10;
		const run = projectWithBadStop(badSeq, (row) => ({
			...row,
			lat: 0,
			lng: 0,
		}));
		expectOnlyBadStopAffected(badSeq, run);
		const bad = run.result.stops.find((s) => s.seq === badSeq);
		expect(bad?.flags).toEqual(["stop-off-shape"]);
		// 나쁜 정류소도 앞뒤 정류소 사이에 둔다.
		const prev = run.result.stops.find((s) => s.seq === badSeq - 1);
		const next = run.result.stops.find((s) => s.seq === badSeq + 1);
		expect(bad?.distanceM ?? -1).toBeGreaterThanOrEqual(prev?.distanceM ?? 0);
		expect(bad?.distanceM ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
			next?.distanceM ?? 0
		);
	});

	it(
		"one displaced stop drags at most a few others on 6411 (fuzz)",
		() => {
			// 왕복 노선에서 좌표가 틀린 정류소 하나가 오는 길·옆 도로에 붙어 뒤 정류소를 끌고 가지 않는지,
			// 모든 seq × 거리 × 방향으로 확인한다.
			const { coords, stops } = load6411();
			const baseline = projectStopsForward(coords, stops).stops;
			const failures: string[] = [];
			for (const distanceM of FUZZ_DISTANCES_M) {
				for (const [east, north] of FUZZ_DIRECTIONS) {
					for (const target of stops) {
						const bad = stops.map((row) =>
							row.seq === target.seq
								? displace(row, east * distanceM, north * distanceM)
								: row
						);
						const result = projectStopsForward(coords, bad).stops;
						const dragged = countDragged(target.seq, baseline, result);
						const monotone = result.every(
							(s, i) =>
								i === 0 || s.distanceM >= (result[i - 1]?.distanceM ?? 0)
						);
						if (dragged > MAX_DRAGGED_STOPS || !monotone) {
							failures.push(
								`seq ${target.seq} (${east * distanceM}, ${north * distanceM}): ${dragged} dragged, monotone ${monotone}`
							);
						}
					}
				}
			}
			expect(failures).toEqual([]);
		},
		FUZZ_TIMEOUT_MS
	);

	it("an absurd apiSectDistM does not pull a stop to the return leg on 6411", () => {
		// 창 너비가 2 × apiSectDistM에 비례하면 20km 값 하나로 오는 길 같은 도로까지 닿았다.
		const badSeq = 49;
		const { coords, stops } = load6411();
		const baseline = projectStopsForward(coords, stops).stops;
		const bad = stops.map((row) =>
			row.seq === badSeq ? { ...row, apiSectDistM: 20_000 } : row
		);
		const result = projectStopsForward(coords, bad).stops;
		expect(countDragged(-1, baseline, result)).toBe(0);
	});

	it("an off-shape turnaround stop does not put the next stop on the outbound leg", () => {
		// 동쪽으로 2km 갔다가 20m 남쪽 차선으로 돌아오는 왕복. 회차 정류소는 모양에서 100m 떨어졌다.
		// seq 4는 가는 길(8m)이 오는 길(12m)보다 가깝지만, 간격은 오는 길과 맞는다.
		const outAndBack = [at(0, 0), at(2000, 0), at(2000, -20), at(0, -20)];
		const stops = [
			stop(1, at(0, 0), 0),
			stop(2, at(1000, 0), 1000),
			stop(3, at(2100, -10), 1010),
			stop(4, at(1500, -8), 510),
			stop(5, at(500, -20), 1000),
		];
		const result = projectStopsForward(outAndBack, stops);
		expect(result.stops[2]?.flags).toEqual(["stop-off-shape"]);
		expect(result.stops[3]?.distanceM ?? 0).toBeCloseTo(2520, 0);
		expect(result.stops[3]?.flags).toEqual([]);
		expect(result.stops[4]?.distanceM ?? 0).toBeCloseTo(3520, 0);
	});

	it("consecutive off-shape stops stay ordered between good stops", () => {
		const line = [at(0, 0), at(3000, 0)];
		const stops = [
			stop(1, at(0, 0), 0),
			stop(2, at(2500, 400), 500),
			stop(3, at(900, -400), 500),
			stop(4, at(1500, 0), 500),
		];
		const result = projectStopsForward(line, stops);
		const distances = result.stops.map((s) => s.distanceM);
		for (let i = 1; i < distances.length; i += 1) {
			expect(distances[i] ?? 0).toBeGreaterThanOrEqual(distances[i - 1] ?? 0);
		}
		expect(result.stops[3]?.distanceM ?? 0).toBeCloseTo(1500, 0);
		expect(result.stops[3]?.flags).toEqual([]);
		expect(result.stops[1]?.flags).toEqual(["stop-off-shape"]);
		expect(result.stops[2]?.flags).toEqual(["stop-off-shape"]);
	});

	it("short closed loop keeps the first stop near the start", () => {
		// 모양이 FIRST_STOP_WINDOW_M보다 짧으면 닫히는 변도 첫 창에 들어온다.
		const square = [at(0, 0), at(500, 0), at(500, 500), at(0, 500), at(0, 0)];
		const stops = [
			stop(1, at(-3, 5), 0),
			stop(2, at(500, 250), 750),
			stop(3, at(250, 500), 500),
			stop(4, at(0, 250), 500),
			stop(5, at(0, 0), 250),
		];
		const result = projectStopsForward(square, stops);
		expect(result.stops[0]?.distanceM ?? -1).toBeLessThan(10);
		expect(result.stops[1]?.distanceM ?? 0).toBeCloseTo(750, 0);
		expect(result.stops[4]?.distanceM ?? 0).toBeGreaterThanOrEqual(
			result.lengthM - 1
		);
		for (const projected of result.stops) {
			expect(projected.flags).toEqual([]);
		}
	});

	it("falls back past the window and flags window-miss", () => {
		// apiSectDistM이 실제 간격보다 훨씬 작으면 옛 창 [0, 0 + 2×10 + 1000] 밖에 붙고 window-miss다.
		const line = [at(0, 0), at(5000, 0)];
		const stops = [stop(1, at(0, 0), 0), stop(2, at(3000, 0), 10)];
		const result = projectStopsForward(line, stops);
		expect(result.stops[1]?.distanceM ?? 0).toBeCloseTo(3000, 0);
		expect(result.stops[1]?.flags).toContain("window-miss");
		expect(result.stops[1]?.flags).not.toContain("stop-off-shape");
	});
});

describe("buildSegments", () => {
	it("6411 segments match fullSectDist", () => {
		const { coords, stops } = load6411();
		const projected = projectStopsForward(coords, stops).stops;
		const segments = buildSegments(stops, projected);
		expect(segments).toHaveLength(116);
		expect(segments[0]).toMatchObject({ fromSeq: 1, toSeq: 2 });
		expect(segments[0]?.apiSectDistM).toBe(stops[1]?.apiSectDistM ?? -1);
		const ratios = segments
			.filter((s) => s.apiSectDistM > 0)
			.map((s) => (s.endM - s.startM) / s.apiSectDistM);
		const ratio = median(ratios);
		expect(ratio).toBeGreaterThanOrEqual(0.95);
		expect(ratio).toBeLessThanOrEqual(1.05);
	});

	it("flags zero-length and mismatched segments", () => {
		const line = [at(0, 0), at(2000, 0)];
		const stops = [
			stop(1, at(100, 0), 0),
			stop(2, at(100, 0), 0),
			stop(3, at(600, 0), 2000),
		];
		const projected = projectStopsForward(line, stops).stops;
		const segments = buildSegments(stops, projected);
		expect(segments).toHaveLength(2);
		expect(segments[0]?.flags).toEqual(["zero-length-segment"]);
		expect(segments[1]).toMatchObject({
			apiSectDistM: 2000,
			fromSeq: 2,
			toSeq: 3,
		});
		expect((segments[1]?.endM ?? 0) - (segments[1]?.startM ?? 0)).toBeCloseTo(
			500,
			0
		);
		expect(segments[1]?.flags).toEqual(["sect-dist-mismatch"]);
	});

	it("does not flag sect-dist-mismatch next to an off-shape stop", () => {
		const line = [at(0, 0), at(2000, 0)];
		// API 거리는 실제 정류소 위치(모양에서 300m 떨어짐)를 거쳐 간다.
		const viaStop = Math.hypot(100, 300);
		const stops = [
			stop(1, at(500, 0), 0),
			stop(2, at(600, 300), viaStop),
			stop(3, at(700, 0), viaStop),
		];
		const projected = projectStopsForward(line, stops).stops;
		expect(projected[1]?.flags).toEqual(["stop-off-shape"]);
		const segments = buildSegments(stops, projected);
		expect(segments.map((segment) => segment.flags)).toEqual([[], []]);
	});

	it("still flags a gross mismatch next to an off-shape stop", () => {
		const line = [at(0, 0), at(2000, 0)];
		const viaStop = Math.hypot(100, 300);
		const stops = [
			stop(1, at(500, 0), 0),
			stop(2, at(600, 300), viaStop),
			stop(3, at(700, 0), 5000),
		];
		const projected = projectStopsForward(line, stops).stops;
		expect(projected[1]?.flags).toEqual(["stop-off-shape"]);
		const segments = buildSegments(stops, projected);
		expect(segments[0]?.flags).toEqual([]);
		expect(segments[1]?.flags).toEqual(["sect-dist-mismatch"]);
	});

	it("does not flag a segment within tolerance", () => {
		const line = [at(0, 0), at(2000, 0)];
		const stops = [stop(1, at(0, 0), 0), stop(2, at(500, 0), 560)];
		const projected = projectStopsForward(line, stops).stops;
		expect(buildSegments(stops, projected)[0]?.flags).toEqual([]);
	});
});

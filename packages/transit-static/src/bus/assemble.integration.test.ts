import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { BUS_PATH_SOURCE, BUS_STATIONS_SOURCE } from "../jobs/fetch-bus-routes";
import { rawPath, resolveDataDir } from "../paths";
import { type AssembleBusRouteResult, assembleBusRoute } from "./assemble";
import { BUS_STOP_WARN_OFFSET_M } from "./project-stops";

const dataDir = resolveDataDir(process.env);

/** 6411: 같은 길을 오가는 왕복, 첫 정류소 앞 약 619m 진입. */
const SEOUL_6411 = "100100290";
/** 01A: 처음과 끝이 같은 정류소(101000331)인 routeType 5 순환. */
const NAMSAN_LOOP_01A = "100100001";
/** 6516: 회차 정류소 순서가 모양과 어긋나는 원천 결함(57~60). */
const ROUTE_6516 = "100100576";
/** 9409: fullSectDist가 모양 간격보다 훨씬 짧은 원천 결함(seq 12). */
const ROUTE_9409 = "107000005";
const LOOP_TERMINAL_STATION = "101000331";
const MAX_6411_OFFSET_M = 30;
const MIN_6411_LEAD_IN_M = 500;
const MAX_6411_LEAD_IN_M = 750;
const MAX_6411_TAIL_M = 1000;
const MIN_MEDIAN_RATIO = 0.95;
const MAX_MEDIAN_RATIO = 1.05;
const MAX_LOOP_LEAD_IN_M = 500;
const MAX_LOOP_TAIL_M = 500;
const MIN_LOOP_LAST_STOP_SHARE = 0.95;

const hasRaws = (routeId: string): boolean =>
	existsSync(rawPath(dataDir, BUS_STATIONS_SOURCE, `${routeId}.json`)) &&
	existsSync(rawPath(dataDir, BUS_PATH_SOURCE, `${routeId}.json`));

const readRawText = (source: string, routeId: string): string =>
	readFileSync(rawPath(dataDir, source, `${routeId}.json`), "utf8");

function assembleReal(
	routeId: string,
	routeName: string,
	stopCount: number
): AssembleBusRouteResult {
	return assembleBusRoute({
		entry: { maxSeq: stopCount, routeId, routeName, stopCount },
		pathBody: readRawText(BUS_PATH_SOURCE, routeId),
		stationsBody: readRawText(BUS_STATIONS_SOURCE, routeId),
	});
}

/** 저장된 getStaionByRoute 원본의 행 수. */
function stationRowCount(routeId: string): number {
	const json = JSON.parse(readRawText(BUS_STATIONS_SOURCE, routeId));
	return json.msgBody.itemList.length;
}

function routeOf(result: AssembleBusRouteResult) {
	const { route } = result;
	if (!route) {
		throw new Error(
			`route did not assemble: ${result.issues.map((i) => i.code).join(", ")}`
		);
	}
	return route;
}

/** 오류 없이 조립되고, 정류소 거리가 seq 순으로 엄격히 늘어난다(오늘 최소 간격 6411 165m, 01A 208m). */
function expectAssembledMonotonic(result: AssembleBusRouteResult) {
	expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
	expect(result.route).toBeDefined();
	const { stops } = routeOf(result);
	for (let i = 1; i < stops.length; i += 1) {
		expect(stops[i]?.distanceM ?? 0).toBeGreaterThan(
			stops[i - 1]?.distanceM ?? 0
		);
	}
}

function median(values: readonly number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[mid] ?? 0)
		: ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const maxOffset = (stops: readonly { offsetM: number }[]): number =>
	Math.max(...stops.map((s) => s.offsetM));

describe.skipIf(!(hasRaws(SEOUL_6411) && hasRaws(NAMSAN_LOOP_01A)))(
	"bus routes against real getStaionByRoute/getRoutePath",
	() => {
		// 지금은 커밋된 픽스처와 같은 모양이다. 다시 받은 뒤의 변화를 잡으려는 것이다.
		it("assembles 6411 monotonically with lead-in and only sect-dist warnings", () => {
			const result = assembleReal(SEOUL_6411, "6411", 117);
			expectAssembledMonotonic(result);
			const route = routeOf(result);
			expect(route.stops.length).toBe(117);
			expect(route.segments.length).toBe(116);
			expect(route.routeType).toBe("4");
			expect(maxOffset(route.stops)).toBeLessThan(MAX_6411_OFFSET_M);
			const first = route.stops[0]?.distanceM ?? 0;
			expect(first).toBeGreaterThanOrEqual(MIN_6411_LEAD_IN_M);
			expect(first).toBeLessThanOrEqual(MAX_6411_LEAD_IN_M);
			expect(route.lengthM - (route.stops[116]?.distanceM ?? 0)).toBeLessThan(
				MAX_6411_TAIL_M
			);
			for (const stop of route.stops) {
				expect(stop.flags).not.toContain("stop-off-shape");
				expect(stop.flags).not.toContain("window-miss");
			}
			const ratio = median(
				route.segments
					.filter((s) => s.apiSectDistM > 0)
					.map((s) => (s.endM - s.startM) / s.apiSectDistM)
			);
			expect(ratio).toBeGreaterThanOrEqual(MIN_MEDIAN_RATIO);
			expect(ratio).toBeLessThanOrEqual(MAX_MEDIAN_RATIO);
			// 오늘은 seq 42→43 하나(shape 599m, api 1473m). 비어 있다고 단정하지 않는다.
			for (const flag of route.qualityFlags) {
				expect(["sect-dist-mismatch"]).toContain(flag);
			}
		});

		it("keeps the 01A loop terminal (same station 101000331) at the shape end", () => {
			const result = assembleReal(NAMSAN_LOOP_01A, "01A", 25);
			expectAssembledMonotonic(result);
			const route = routeOf(result);
			expect(route.routeType).toBe("5");
			expect(route.stops.length).toBe(25);
			expect(route.segments.length).toBe(24);
			const [first] = route.stops;
			const last = route.stops.at(-1);
			expect(first?.stationId).toBe(LOOP_TERMINAL_STATION);
			expect(last?.stationId).toBe(LOOP_TERMINAL_STATION);
			expect(first?.distanceM ?? Number.POSITIVE_INFINITY).toBeLessThan(
				MAX_LOOP_LEAD_IN_M
			);
			expect(route.lengthM - (last?.distanceM ?? 0)).toBeLessThan(
				MAX_LOOP_TAIL_M
			);
			// 마지막 정류소가 시작점으로 붙으면 약 86m가 된다.
			expect(last?.distanceM ?? 0).toBeGreaterThan(
				MIN_LOOP_LAST_STOP_SHARE * route.lengthM
			);
			expect(maxOffset(route.stops)).toBeLessThan(BUS_STOP_WARN_OFFSET_M);
			expect(route.qualityFlags).toEqual([]);
		});
	}
);

/**
 * 원천 결함이 있는 노선의 불변식만 확인한다. 결함 플래그(stop-off-shape, zero-length-segment, window-miss)는
 * 다시 받으면 사라질 수 있으므로 단정하지 않는다. 노선마다 따로 건너뛰어 하나가 빠져도 다른 노선은 돈다.
 */
function expectInvariants(routeId: string, routeName: string) {
	const rowCount = stationRowCount(routeId);
	const result = assembleReal(routeId, routeName, rowCount);
	expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
	const route = routeOf(result);
	expect(route.stops.length).toBe(rowCount);
	for (let i = 1; i < route.stops.length; i += 1) {
		expect(route.stops[i]?.distanceM ?? 0).toBeGreaterThanOrEqual(
			route.stops[i - 1]?.distanceM ?? 0
		);
	}
	for (const segment of route.segments) {
		expect(segment.endM).toBeGreaterThanOrEqual(segment.startM);
	}
	return route;
}

describe.skipIf(!hasRaws(ROUTE_6516))(
	"6516 turnaround against real raws",
	() => {
		it("never places the reversed turnaround stop backwards", () => {
			const route = expectInvariants(ROUTE_6516, "6516");
			const bySeq = new Map(route.stops.map((s) => [s.seq, s]));
			expect(bySeq.get(59)?.distanceM ?? 0).toBeGreaterThanOrEqual(
				bySeq.get(58)?.distanceM ?? Number.POSITIVE_INFINITY
			);
		});
	}
);

describe.skipIf(!hasRaws(ROUTE_9409))(
	"9409 short fullSectDist against real raws",
	() => {
		it("assembles with monotonic stops and non-negative segments", () => {
			expectInvariants(ROUTE_9409, "9409");
		});
	}
);

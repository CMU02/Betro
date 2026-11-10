import { projectPoint } from "@Betro/transit-static/track/project";
import type { BusObservation } from "../observation";
import type { BusReference } from "../reference";
import { kstToEpochMs } from "../time";
import type { BusPositionRow } from "../upstream/bus-position";

/** 구간 거리와 GPS 투영 거리 차이가 이 값(미터)보다 크면 경고한다. */
export const BUS_DISTANCE_MISMATCH_M = 150;
/** 모양 좌표가 있으면 GPS를 모양에 투영한다. */
export const BUS_GPS_PROJECTION: boolean = true;
/**
 * GPS는 구간 거리 기준 ±이 값(미터) 안의 모양에만 투영한다.
 * 왕복 노선에서 반대 방향 선으로 붙는 것을 막는다.
 */
export const BUS_GPS_PROJECTION_WINDOW_M = 1000;

/** turf `length`와 같은 지구 반지름(미터). */
const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

type LngLat = [number, number];

const haversineM = (a: LngLat, b: LngLat): number => {
	const dLat = (b[1] - a[1]) * DEG_TO_RAD;
	const dLng = (b[0] - a[0]) * DEG_TO_RAD;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a[1] * DEG_TO_RAD) *
			Math.cos(b[1] * DEG_TO_RAD) *
			Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

const cumulativeCache = new WeakMap<LngLat[], number[]>();

/** 각 좌표까지 선을 따라 잰 누적 거리(미터). 같은 좌표 배열은 캐시한다. */
function cumulativeLengths(coords: LngLat[]): number[] {
	const cached = cumulativeCache.get(coords);
	if (cached) {
		return cached;
	}
	const cum: number[] = [0];
	let total = 0;
	for (let i = 1; i < coords.length; i += 1) {
		total += haversineM(coords[i - 1] as LngLat, coords[i] as LngLat);
		cum.push(total);
	}
	cumulativeCache.set(coords, cum);
	return cum;
}

/** 누적 거리 `m` 지점의 좌표(구간 안에서 선형 보간). */
function pointAt(coords: LngLat[], cum: number[], m: number): LngLat {
	let i = 1;
	while (i < cum.length - 1 && (cum[i] as number) < m) {
		i += 1;
	}
	const a = coords[i - 1] as LngLat;
	const b = coords[i] as LngLat;
	const from = cum[i - 1] as number;
	const span = (cum[i] as number) - from;
	const t = span > 0 ? Math.min(1, Math.max(0, (m - from) / span)) : 0;
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 선을 누적 거리 [lo, hi] 구간으로 자른다. */
function clipLine(
	coords: LngLat[],
	cum: number[],
	lo: number,
	hi: number
): LngLat[] {
	const clipped: LngLat[] = [pointAt(coords, cum, lo)];
	for (let i = 0; i < coords.length; i += 1) {
		const c = cum[i] as number;
		if (c > lo && c < hi) {
			clipped.push(coords[i] as LngLat);
		}
	}
	clipped.push(pointAt(coords, cum, hi));
	return clipped;
}

/**
 * GPS를 `centerM` ±{@link BUS_GPS_PROJECTION_WINDOW_M} 안의 모양에만 투영해
 * 선 시작점 기준 거리(미터)를 돌려준다.
 */
function projectInWindow(
	coords: LngLat[],
	point: LngLat,
	centerM: number
): number | null {
	const cum = cumulativeLengths(coords);
	const total = cum.at(-1) ?? 0;
	const lo = Math.max(0, centerM - BUS_GPS_PROJECTION_WINDOW_M);
	const hi = Math.min(total, centerM + BUS_GPS_PROJECTION_WINDOW_M);
	if (hi <= lo) {
		return null;
	}
	return lo + projectPoint(clipLine(coords, cum, lo, hi), point).distanceM;
}

export interface BusPrev {
	shapeDistanceM: number | null;
	sourceAt: number;
}

function shapeDistance(
	row: BusPositionRow,
	segment: { endM: number; startM: number } | undefined,
	flags: string[]
): number | null {
	if (!segment) {
		flags.push("unknown-segment");
		return null;
	}
	if (row.fullSectDistM <= 0) {
		flags.push("zero-full-sect");
		return segment.startM;
	}
	let ratio = row.sectDistM / row.fullSectDistM;
	if (ratio > 1) {
		flags.push("sect-dist-over");
		ratio = 1;
	}
	return segment.startM + ratio * (segment.endM - segment.startM);
}

/** 잘못된 `dataTm`이면 관측 시각으로 대신하고 플래그를 남긴다. */
function parseSourceAt(
	dataTm: string,
	observedAt: number,
	flags: string[]
): number {
	try {
		return kstToEpochMs(dataTm);
	} catch {
		flags.push("bad-source-time");
		return observedAt;
	}
}

export function normalizeBusPositions(
	routeId: string,
	rows: BusPositionRow[],
	ref: BusReference,
	prev: ReadonlyMap<string, BusPrev>,
	observedAt: number
): BusObservation[] {
	const route = ref.routes.get(routeId);
	return rows.map((row) => {
		const flags: string[] = [];
		let shapeDistanceM: number | null = null;
		let gpsProjectedDistanceM: number | null = null;
		if (route) {
			shapeDistanceM = shapeDistance(
				row,
				route.segmentsBySeq.get(row.sectOrd),
				flags
			);
			if (
				BUS_GPS_PROJECTION &&
				shapeDistanceM !== null &&
				route.coords &&
				route.coords.length >= 2
			) {
				gpsProjectedDistanceM = projectInWindow(
					route.coords,
					[row.gpsX, row.gpsY],
					shapeDistanceM
				);
				if (
					gpsProjectedDistanceM !== null &&
					Math.abs(gpsProjectedDistanceM - shapeDistanceM) >
						BUS_DISTANCE_MISMATCH_M
				) {
					flags.push("distance-mismatch");
				}
			}
		} else {
			flags.push("unknown-route");
		}
		const sourceAt = parseSourceAt(row.dataTm, observedAt, flags);
		const before = prev.get(`${routeId}|${row.vehId}`) ?? prev.get(row.vehId);
		if (before) {
			if (
				shapeDistanceM !== null &&
				before.shapeDistanceM !== null &&
				shapeDistanceM < before.shapeDistanceM
			) {
				flags.push("backwards");
			}
			if (sourceAt < before.sourceAt) {
				flags.push("time-backwards");
			}
		}
		return {
			busType: row.busType,
			congestion: row.congetion,
			gpsProjectedDistanceM,
			lastTrip: row.islastyn,
			lat: row.gpsY,
			lng: row.gpsX,
			observedAt,
			plainNo: row.plainNo,
			qualityFlags: flags,
			routeId,
			sectOrd: row.sectOrd,
			shapeDistanceM,
			sourceAt,
			sourceAtRaw: row.dataTm,
			stopped: row.stopFlag,
			vehId: row.vehId,
		};
	});
}

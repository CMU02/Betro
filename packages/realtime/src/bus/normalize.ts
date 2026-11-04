import { projectPoint } from "@Betro/transit-static/track/project";
import type { BusObservation } from "../observation";
import type { BusReference } from "../reference";
import { kstToEpochMs } from "../time";
import type { BusPositionRow } from "../upstream/bus-position";

/** 구간 거리와 GPS 투영 거리 차이가 이 값(미터)보다 크면 경고한다. */
export const BUS_DISTANCE_MISMATCH_M = 150;
/** 모양 좌표가 있으면 GPS를 모양에 투영한다. */
export const BUS_GPS_PROJECTION: boolean = true;

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
			if (BUS_GPS_PROJECTION && route.coords && route.coords.length >= 2) {
				gpsProjectedDistanceM = projectPoint(route.coords, [
					row.gpsX,
					row.gpsY,
				]).distanceM;
				if (
					shapeDistanceM !== null &&
					Math.abs(gpsProjectedDistanceM - shapeDistanceM) >
						BUS_DISTANCE_MISMATCH_M
				) {
					flags.push("distance-mismatch");
				}
			}
		} else {
			flags.push("unknown-route");
		}
		const sourceAt = kstToEpochMs(row.dataTm);
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

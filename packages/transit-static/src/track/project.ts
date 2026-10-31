import { lineString } from "@turf/helpers";
import { length } from "@turf/length";
import { nearestPointOnLine } from "@turf/nearest-point-on-line";
import type { LngLat } from "./stitch";

/** 선로에서 이 거리(미터)보다 멀면 경고한다. */
export const STATION_WARN_OFFSET_M = 80;
/** 선로에서 이 거리(미터)보다 멀면 그 shape 위의 역으로 보지 않는다. */
export const STATION_MAX_OFFSET_M = 150;

export interface StationPoint {
	lat: number;
	lng: number;
	statnId: string;
}

export interface ProjectedPoint {
	/** 선 시작점에서 투영점까지 선을 따라 잰 거리(미터). */
	distanceM: number;
	/** 점에서 선까지의 최단 거리(미터). */
	offsetM: number;
	snapped: LngLat;
}

export interface ProjectionResult {
	offShape: { offsetM: number; statnId: string }[];
	onShape: { distanceM: number; offsetM: number; statnId: string }[];
}

export const lineLengthM = (coords: LngLat[]): number =>
	length(lineString(coords), { units: "meters" });

export function projectPoint(coords: LngLat[], point: LngLat): ProjectedPoint {
	const nearest = nearestPointOnLine(lineString(coords), point, {
		units: "meters",
	});
	const [lng, lat] = nearest.geometry.coordinates;
	return {
		distanceM: nearest.properties.location ?? 0,
		offsetM: nearest.properties.dist ?? 0,
		snapped: [lng ?? 0, lat ?? 0],
	};
}

export function projectStations(
	coords: LngLat[],
	stations: StationPoint[]
): ProjectionResult {
	const onShape: ProjectionResult["onShape"] = [];
	const offShape: ProjectionResult["offShape"] = [];
	for (const station of stations) {
		const { distanceM, offsetM } = projectPoint(coords, [
			station.lng,
			station.lat,
		]);
		if (offsetM <= STATION_MAX_OFFSET_M) {
			onShape.push({ distanceM, offsetM, statnId: station.statnId });
		} else {
			offShape.push({ offsetM, statnId: station.statnId });
		}
	}
	onShape.sort((a, b) => a.distanceM - b.distanceM);
	return { offShape, onShape };
}

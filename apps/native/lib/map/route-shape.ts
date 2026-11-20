import { cumulativeM, pointAlong } from "./motion";

type LngLat = [number, number];

export interface MapCoord {
	latitude: number;
	longitude: number;
}

/** 네이버 지도 `Region`과 같은 모양. 남서쪽 모서리와 그 위·오른쪽으로의 폭이다. */
export interface MapRegion {
	latitude: number;
	latitudeDelta: number;
	longitude: number;
	longitudeDelta: number;
}

/** 점 하나뿐이어도 화면이 너무 확대되지 않게 두는 최소 폭(도). */
const MIN_REGION_DELTA_DEG = 0.005;
const MIN_PATH_POINTS = 2;

/** 선을 거리 `fromM`~`toM` 사이만 잘라 낸다. 두 끝은 선 위의 보간점이고 그 사이 꼭짓점은 그대로 둔다. */
function sliceShape(
	shape: readonly LngLat[],
	fromM: number,
	toM: number
): LngLat[] {
	const cum = cumulativeM(shape);
	const total = cum.at(-1) ?? 0;
	const from = Math.min(Math.max(fromM, 0), total);
	const to = Math.min(Math.max(toM, 0), total);
	if (to <= from) {
		return [];
	}
	const start = pointAlong(shape, from);
	const end = pointAlong(shape, to);
	if (start === null || end === null) {
		return [];
	}
	const points: LngLat[] = [[start.longitude, start.latitude]];
	for (const [index, point] of shape.entries()) {
		const at = cum[index] ?? 0;
		if (at > from && at < to) {
			points.push([point[0], point[1]]);
		}
	}
	points.push([end.longitude, end.latitude]);
	return points;
}

/**
 * 승차~하차 구간의 선. 순환 가지에서 하차가 승차보다 앞 거리면 이음매를 넘어 두 조각이 된다.
 * 어느 한쪽 위치라도 모르면 진하게 그릴 곳이 없다.
 */
export function spanSegments(
	shape: readonly LngLat[],
	boardM: number | null,
	alightM: number | null
): LngLat[][] {
	if (boardM === null || alightM === null || shape.length < MIN_PATH_POINTS) {
		return [];
	}
	const total = cumulativeM(shape).at(-1) ?? 0;
	const pieces =
		alightM >= boardM
			? [sliceShape(shape, boardM, alightM)]
			: [sliceShape(shape, boardM, total), sliceShape(shape, 0, alightM)];
	return pieces.filter((piece) => piece.length >= MIN_PATH_POINTS);
}

/** 참조 데이터의 `[lng, lat]`을 지도 좌표로 바꾼다. */
export function toCoords(points: readonly (readonly number[])[]): MapCoord[] {
	return points.map((point) => ({
		latitude: point[1] ?? 0,
		longitude: point[0] ?? 0,
	}));
}

/** 점들이 모두 들어오는 영역. 폭마다 `paddingRatio`만큼 양쪽에 여백을 둔다. 점이 없으면 null. */
export function regionOf(
	points: readonly (readonly number[])[],
	paddingRatio: number
): MapRegion | null {
	if (points.length === 0) {
		return null;
	}
	let minLat = Number.POSITIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;
	let minLng = Number.POSITIVE_INFINITY;
	let maxLng = Number.NEGATIVE_INFINITY;
	for (const [lng = 0, lat = 0] of points) {
		minLat = Math.min(minLat, lat);
		maxLat = Math.max(maxLat, lat);
		minLng = Math.min(minLng, lng);
		maxLng = Math.max(maxLng, lng);
	}
	const scale = 1 + 2 * paddingRatio;
	const latitudeDelta = Math.max(maxLat - minLat, MIN_REGION_DELTA_DEG) * scale;
	const longitudeDelta =
		Math.max(maxLng - minLng, MIN_REGION_DELTA_DEG) * scale;
	return {
		latitude: (minLat + maxLat) / 2 - latitudeDelta / 2,
		latitudeDelta,
		longitude: (minLng + maxLng) / 2 - longitudeDelta / 2,
		longitudeDelta,
	};
}

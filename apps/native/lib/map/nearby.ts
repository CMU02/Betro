import type { PermissionStatus } from "@/lib/onboarding/onboarding";
import type { SubwayStationPoint } from "./map-client";

/** 근처 지하철 노선을 고르는 반경(지도 설계 2.5). */
export const NEARBY_RADIUS_M = 1500;

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

export interface Coordinate {
	latitude: number;
	longitude: number;
}

/** 두 좌표 사이의 큰원 거리(미터). 기기 안에서만 계산한다. */
function distanceM(a: Coordinate, b: Coordinate): number {
	const dLat = (b.latitude - a.latitude) * DEG_TO_RAD;
	const dLng = (b.longitude - a.longitude) * DEG_TO_RAD;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.latitude * DEG_TO_RAD) *
			Math.cos(b.latitude * DEG_TO_RAD) *
			Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 반경 안 역들의 노선 키를 가까운 순서로, 중복 없이 돌려준다.
 * 같은 노선의 여러 역 중 가장 가까운 역의 거리로 순서를 정한다.
 */
export function nearbyLines(
	stations: readonly SubwayStationPoint[],
	here: Coordinate,
	radiusM: number
): string[] {
	const nearestByLine = new Map<string, number>();
	for (const station of stations) {
		const meters = distanceM(here, {
			latitude: station.lat,
			longitude: station.lng,
		});
		if (meters > radiusM) {
			continue;
		}
		const known = nearestByLine.get(station.line);
		if (known === undefined || meters < known) {
			nearestByLine.set(station.line, meters);
		}
	}
	return [...nearestByLine.entries()]
		.sort(([, a], [, b]) => a - b)
		.map(([line]) => line);
}

/**
 * 위치 권한이 `granted`일 때만 위치를 한 번 읽는다. 허용되지 않았으면 위치 함수를 부르지 않고 `null`이다.
 * 결과는 호출한 쪽의 화면 상태에만 두고, 저장하거나 서버로 보내지 않는다.
 */
export async function locateOnce(
	permission: PermissionStatus,
	getPosition: () => Promise<Coordinate>
): Promise<Coordinate | null> {
	if (permission !== "granted") {
		return null;
	}
	return await getPosition();
}

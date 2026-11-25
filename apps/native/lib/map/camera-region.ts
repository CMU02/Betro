import { cumulativeM } from "./motion";
import type { MapLeg } from "./use-map-data";

/**
 * 첫 구간(차량을 보이는 구간 중 첫째)에서 승차 정류장(역)에 가장 가까이 다가오는 차량의 `[lng, lat]`.
 * 카메라가 경로와 함께 이 차량을 담아, 다음 차가 화면 밖에 있지 않게 한다(지도 설계 3장).
 * 그 구간에 차량이 없으면 null이다. 순환선은 이음매를 넘어 뒤에 있는 차량도 승차 정류장 뒤로 센다.
 */
export function nearestApproachingPoint(
	legs: readonly MapLeg[]
): [number, number] | null {
	const first = legs.find(
		(mapLeg) =>
			mapLeg.showVehicles &&
			mapLeg.boardM !== null &&
			mapLeg.track !== null &&
			mapLeg.vehicles.length > 0
	);
	if (!first || first.boardM === null || first.track === null) {
		return null;
	}
	const { boardM } = first;
	const totalM = cumulativeM(first.track.shape).at(-1) ?? 0;
	let best: { behindM: number; point: [number, number] } | null = null;
	for (const vehicle of first.vehicles) {
		const raw = boardM - vehicle.motion.shownDistanceM;
		const behindM = raw < 0 ? raw + totalM : raw;
		if (best === null || behindM < best.behindM) {
			best = { behindM, point: [vehicle.longitude, vehicle.latitude] };
		}
	}
	return best?.point ?? null;
}

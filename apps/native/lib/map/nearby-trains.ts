import type { SubwayMap, SubwaySnapshotVehicle } from "./map-client";
import { type Coordinate, distanceM } from "./nearby";

type SubwayBranch = SubwayMap["branches"][number];

function bareLineKey(line: string): string {
	return line.slice(line.indexOf(":") + 1);
}

/**
 * 근처 노선(`seoul-subway:line2` 꼴 ref)의 열차만 남긴다. 장소가 없을 때만 쓰는 한 경로 원칙의 예외다(지도 설계 2.5).
 * 스냅샷의 `lineKey`는 접두사 없는 키다.
 */
export function trainsOnLines(
	vehicles: readonly SubwaySnapshotVehicle[],
	lines: readonly string[]
): SubwaySnapshotVehicle[] {
	const keys = new Set(lines.map(bareLineKey));
	return vehicles.filter((vehicle) => keys.has(vehicle.lineKey));
}

/** 열차 방향으로 달리며 지금 역을 지나는 가지. 역이나 가지를 모르면 null이라 그리지 않는다. */
export function branchForTrain(
	map: SubwayMap,
	vehicle: SubwaySnapshotVehicle
): SubwayBranch | null {
	if (vehicle.statnId === null) {
		return null;
	}
	const stop = `seoul-subway:${vehicle.statnId}`;
	return (
		map.branches.find(
			(branch) =>
				branch.direction === vehicle.direction &&
				branch.stations.some((station) => station.stop === stop)
		) ?? null
	);
}

/**
 * 내 위치에서 반경 안에 있는 열차만 남긴다. 근처 노선이어도 화면 밖 열차는 그리지 않는다(지도 설계 4.2).
 * 거리는 기기에서만 잰다.
 */
export function trainsNear<T extends { observedPosition: Coordinate }>(
	trains: readonly T[],
	here: Coordinate,
	radiusM: number
): T[] {
	return trains.filter(
		(train) => distanceM(here, train.observedPosition) <= radiusM
	);
}

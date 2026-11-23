import type { RouteStopArrival } from "./seoul-bus";

/** 차량 순번이 이만큼 그대로면 멈춘 차량이다. 실험의 최대 변화 간격(GBIS 120초, TAGO 좌표 419초)을 감안했다. */
export const FROZEN_VEHICLE_MS = 300_000;

export interface VehicleSeen {
	seqNow: number;
	/** 이 순번이 처음 보인 시각. */
	since: number;
}

/**
 * 차량 ID → 순번이 마지막으로 바뀐 시각. 예측 초는 보지 않는다(멈춘 차량도 예측 초는 흔들린다).
 * 이번 도착에 없는 차량은 버린다.
 */
export function updateSeen(
	prev: Readonly<Record<string, VehicleSeen>>,
	arrivals: readonly RouteStopArrival[],
	now: number
): Record<string, VehicleSeen> {
	const next: Record<string, VehicleSeen> = {};
	for (const arrival of arrivals) {
		for (const vehicle of arrival.vehicles) {
			const before = prev[vehicle.vehicleId];
			next[vehicle.vehicleId] =
				before && before.seqNow === vehicle.seqNow
					? before
					: { seqNow: vehicle.seqNow, since: now };
		}
	}
	return next;
}

/** 순번이 `FROZEN_VEHICLE_MS`보다 오래 그대로인 차량을 도착에서 뺀다. 기록이 없는 차량은 남긴다. */
export function dropFrozen(
	arrivals: readonly RouteStopArrival[],
	seen: Readonly<Record<string, VehicleSeen>>,
	now: number
): RouteStopArrival[] {
	return arrivals.map((arrival) => ({
		...arrival,
		vehicles: arrival.vehicles.filter((vehicle) => {
			const entry = seen[vehicle.vehicleId];
			return !(entry && now - entry.since > FROZEN_VEHICLE_MS);
		}),
	}));
}

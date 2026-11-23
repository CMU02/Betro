import { UNKNOWN_POSITION_PREFIX } from "./regional-bus";
import type { RouteStopArrival } from "./seoul-bus";

/** 차량 순번이 이만큼 그대로면 멈춘 차량이다. 실험의 최대 변화 간격(GBIS 120초, TAGO 좌표 419초)을 감안했다. */
export const FROZEN_VEHICLE_MS = 300_000;

export interface VehicleSeen {
	/** 마지막으로 본 시각. 이전 형식의 기록에는 없다. */
	lastSeen?: number;
	seqNow: number;
	/** 이 순번이 처음 보인 시각. */
	since: number;
}

/**
 * 차량 ID → 순번이 마지막으로 바뀐 시각. 예측 초는 보지 않는다(멈춘 차량도 예측 초는 흔들린다).
 * 이번 도착에 없는 차량도 마지막으로 본 지 `FROZEN_VEHICLE_MS`까지는 기록을 둔다. 걸러진 직전 도착을
 * 둔 poll이나 한 poll만 빠진 차량이 다시 나올 때 새로 세지 않으려는 것이다. `lastSeen`이 없는 이전
 * 기록은 그 기록을 쓴 poll에서 본 것이니 지금 본 것으로 친다. `tago-pos:` 차량은 poll마다 다른 차량일
 * 수 있어 이번 도착에 없으면 버린다.
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
					? { ...before, lastSeen: now }
					: { lastSeen: now, seqNow: vehicle.seqNow, since: now };
		}
	}
	for (const [vehicleId, entry] of Object.entries(prev)) {
		if (vehicleId in next || vehicleId.startsWith(UNKNOWN_POSITION_PREFIX)) {
			continue;
		}
		const lastSeen = entry.lastSeen ?? now;
		if (now - lastSeen <= FROZEN_VEHICLE_MS) {
			next[vehicleId] = { ...entry, lastSeen };
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

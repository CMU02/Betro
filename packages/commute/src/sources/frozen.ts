import { UNKNOWN_POSITION_PREFIX } from "./regional-bus";
import type { RouteStopArrival } from "./seoul-bus";

/** 차량 순번이 이만큼 그대로면 멈춘 차량이다. 실험의 최대 변화 간격(GBIS 120초, TAGO 좌표 419초)을 감안했다. */
export const FROZEN_VEHICLE_MS = 300_000;

/**
 * 위치 목록 차량의 기록 키 접두사. 도착의 순번과 위치 목록의 순번은 다른 호출에서 와 한 정거장쯤
 * 다를 수 있어, 한 기록에 섞으면 poll마다 변화로 보인다. 그래서 따로 센다.
 */
const POSITION_KEY_PREFIX = "pos:";

export interface VehicleSeen {
	/** 마지막으로 본 시각. 이전 형식의 기록에는 없다. */
	lastSeen?: number;
	seqNow: number;
	/** 이 순번이 처음 보인 시각. */
	since: number;
}

const isFrozen = (entry: VehicleSeen | undefined, now: number): boolean =>
	entry !== undefined && now - entry.since > FROZEN_VEHICLE_MS;

/**
 * 차량 ID → 순번이 마지막으로 바뀐 시각. 예측 초는 보지 않는다(멈춘 차량도 예측 초는 흔들린다).
 * `positions`는 이번 poll에 받은 위치 목록(차량 ID → 순번)이다. 직전 위치를 이어 쓴 poll은 넘기지
 * 않는다(이어 쓴 위치는 관측이 아니다).
 * 이번에 보지 못한 차량도 마지막으로 본 지 `FROZEN_VEHICLE_MS`까지는 기록을 둔다. 걸러진 직전 도착을
 * 둔 poll이나 한 poll만 빠진 차량이 다시 나올 때 새로 세지 않으려는 것이다. `lastSeen`이 없는 이전
 * 기록은 그 기록을 쓴 poll에서 본 것이니 지금 본 것으로 친다. `tago-pos:` 차량은 poll마다 다른 차량일
 * 수 있어 이번 도착에 없으면 버린다.
 */
export function updateSeen(
	prev: Readonly<Record<string, VehicleSeen>>,
	arrivals: readonly RouteStopArrival[],
	now: number,
	positions?: Readonly<Record<string, number>>
): Record<string, VehicleSeen> {
	const next: Record<string, VehicleSeen> = {};
	const observe = (key: string, seqNow: number): void => {
		const before = prev[key];
		next[key] =
			before && before.seqNow === seqNow
				? { ...before, lastSeen: now }
				: { lastSeen: now, seqNow, since: now };
	};
	for (const arrival of arrivals) {
		for (const vehicle of arrival.vehicles) {
			observe(vehicle.vehicleId, vehicle.seqNow);
		}
	}
	for (const [vehicleId, seq] of Object.entries(positions ?? {})) {
		observe(`${POSITION_KEY_PREFIX}${vehicleId}`, seq);
	}
	for (const [key, entry] of Object.entries(prev)) {
		if (key in next || key.startsWith(UNKNOWN_POSITION_PREFIX)) {
			continue;
		}
		const lastSeen = entry.lastSeen ?? now;
		if (now - lastSeen <= FROZEN_VEHICLE_MS) {
			next[key] = { ...entry, lastSeen };
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
		vehicles: arrival.vehicles.filter(
			(vehicle) => !isFrozen(seen[vehicle.vehicleId], now)
		),
	}));
}

/**
 * 위치 목록(차량 ID → 순번)에서 위치 목록의 순번이 `FROZEN_VEHICLE_MS`보다 오래 그대로인 차량을 뺀다.
 * 탄 GBIS 차량은 하차 정류장 도착에 없고 위치 목록에만 나오는 일이 많아 따로 본다.
 */
export function dropFrozenPositions(
	positions: Readonly<Record<string, number>>,
	seen: Readonly<Record<string, VehicleSeen>>,
	now: number
): Record<string, number> {
	return Object.fromEntries(
		Object.entries(positions).filter(
			([vehicleId]) =>
				!isFrozen(seen[`${POSITION_KEY_PREFIX}${vehicleId}`], now)
		)
	);
}

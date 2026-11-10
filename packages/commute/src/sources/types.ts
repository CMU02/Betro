import type { Leg } from "../plan";

/**
 * 도착 시각을 낸 방법. 정확도 기록(5.4)이 방법별로 묶어 볼 수 있게 값마다 남긴다.
 * - official: 출처의 공식 예측 그대로
 * - official-corrected: 공식 예측에 노선별 편향을 더한 값
 * - timetable: 시간표 도착
 * - headway: 배차간격으로 미룬 값
 * - extrapolated: 공식 예측이 닿는 가장 먼 정류장에서 평균 속도로 늘린 값
 */
export type ArrivalMethod =
	| "official"
	| "official-corrected"
	| "timetable"
	| "headway"
	| "extrapolated";

/** 정류장(역)으로 다가오는 차량 하나. */
export interface Approaching {
	etaAt: number | null;
	lastOfDay: boolean;
	method: ArrivalMethod | null;
	plate: string | null;
	stopsAway: number | null;
	vehicleId: string;
}

/** 한 정류장(역)의 도착판. */
export interface StopBoard {
	/** 가까운 순서. */
	approaching: Approaching[];
	/** 출처에서 받은 시각. */
	fetchedAt: number;
	headwayMs: number | null;
	/** 직전 도착판에는 다가오고 있었는데 지금은 그 정류장을 지난 차량. */
	passed: { at: number; vehicleId: string }[];
	/**
	 * 직전 도착판의 `sourceAt`. `passed`의 차량은 이 시각과 `sourceAt` 사이에 정류장을 지났다
	 * (정확도 기록의 실제 도착 범위, 5.4). 직전 도착판이 없으면 없다.
	 */
	prevSourceAt?: number;
	/** 출처가 이 값을 만든 시각. 묵음 판단에 쓴다. */
	sourceAt: number;
}

/** 탄 차량의 하차 정류장(역) 도착. */
export interface Progress {
	etaAt: number | null;
	method: ArrivalMethod | null;
	stopsAway: number | null;
}

/** 세션 로직이 보는 유일한 창구. 출처는 `sources/assemble.ts`가 감춘다. */
export interface TransitBoards {
	board: (leg: Leg, at: "board" | "alight") => StopBoard | null;
	progress: (leg: Leg, vehicleId: string) => Progress | null;
	rideMs: (leg: Leg, vehicleId: string | null) => number | null;
}

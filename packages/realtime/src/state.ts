import type { BusObservation, SubwayObservation } from "./observation";

/** 마지막으로 본 뒤 이 시간이 지나면 지하철 열차를 최신 상태에서 뺀다. */
export const SUBWAY_TTL_MS = 300_000;
/** 마지막으로 본 뒤 이 시간이 지나면 버스 차량을 최신 상태에서 뺀다. */
export const BUS_TTL_MS = 300_000;

const SAVED_STATE_VERSION = 1;

/** 최신 상태 한 항목: 마지막 관측 그대로 + 수집기가 마지막으로 그 차량을 본 시각. */
export type SubwaySnapshotVehicle = SubwayObservation & { lastSeenAt: number };
export type BusSnapshotVehicle = BusObservation & { lastSeenAt: number };

/**
 * 스냅샷 JSON(`GET /v1/snapshot/{subway,bus}` 본문, v1).
 *
 * ```jsonc
 * {
 *   "generatedAt": 1793678684100,   // 스냅샷을 만든 시각(UTC epoch ms)
 *   "staleSince": null,             // 소스가 비어 온 첫 시각. 정상이면 null
 *   "vehicles": [                   // 키(`lineKey|rawTrainNo` 또는 `routeId|vehId`) 순
 *     {
 *       // SubwayObservation 또는 BusObservation 필드 전부(observation.ts, 수집 설계 8장)
 *       "observedAt": 1793678684100, "sourceAt": 1793678674000, ...,
 *       "lastSeenAt": 1793678684100 // 이 차량이 마지막으로 응답에 나온 수집 시각
 *     }
 *   ],
 *   // 버스만: 비어 온 노선별 staleSince. staleSince는 그중 가장 이른 값
 *   "staleRoutes": { "100100029": 1793678714100 }
 * }
 * ```
 *
 * - 응답이 잠깐 비거나 일부만 와도 차량은 지우지 않는다. 마지막 관측을 유지하고
 *   `lastSeenAt`이 TTL(지하철·버스 5분)을 넘은 차량만 뺀다. 보간 엔진은
 *   `generatedAt - lastSeenAt`으로 각 차량의 묵은 정도를 판단한다.
 * - 위치를 정하지 못한 열차(`position-unknown`)도 그대로 들어 있다. 거를지는 읽는 쪽이 정한다.
 */
export interface Snapshot<V> {
	generatedAt: number;
	staleSince: number | null;
	vehicles: V[];
}
export type SubwaySnapshot = Snapshot<SubwaySnapshotVehicle>;
export interface BusSnapshot extends Snapshot<BusSnapshotVehicle> {
	staleRoutes: Record<string, number>;
}

interface Entry<O> {
	lastSeenAt: number;
	obs: O;
}

/** `save()` 결과. JSON으로 그대로 직렬화해 DO 저장소에 둔다. */
export interface SavedState {
	bus: {
		staleSinceByRoute: Record<string, number>;
		vehicles: Entry<BusObservation>[];
	};
	subway: {
		staleSince: number | null;
		trains: Entry<SubwayObservation>[];
	};
	version: typeof SAVED_STATE_VERSION;
}

export interface BusPrevPosition {
	shapeDistanceM: number | null;
	sourceAt: number;
}

export type SourceKind = "subway" | { busRouteId: string };

const trainKey = (o: SubwayObservation): string =>
	`${o.lineKey}|${o.rawTrainNo}`;
const vehicleKey = (routeId: string, vehId: string): string =>
	`${routeId}|${vehId}`;

function sortedVehicles<O>(
	entries: Map<string, Entry<O>>,
	now: number,
	ttlMs: number
): (O & { lastSeenAt: number })[] {
	return [...entries.entries()]
		.filter(([, e]) => now - e.lastSeenAt <= ttlMs)
		.sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
		.map(([, e]) => ({ ...e.obs, lastSeenAt: e.lastSeenAt }));
}

function dropExpired<O>(
	entries: Map<string, Entry<O>>,
	now: number,
	ttlMs: number
): void {
	for (const [key, e] of entries) {
		if (now - e.lastSeenAt > ttlMs) {
			entries.delete(key);
		}
	}
}

/**
 * 노선별·차량별 마지막 관측(4단계 설계 4.4, 4.7).
 * - 지하철: 열차 키 `${lineKey}|${rawTrainNo}`. (statnId, status)가 직전과 다를 때만 전이.
 * - 버스: 차량 키 `${routeId}|${vehId}`. `sourceAt`(dataTm)이 직전과 다를 때만 새 관측.
 */
export class LatestState {
	readonly #trains = new Map<string, Entry<SubwayObservation>>();
	readonly #buses = new Map<string, Entry<BusObservation>>();
	#subwayStaleSince: number | null = null;
	readonly #busStaleSince = new Map<string, number>();

	constructor(saved?: SavedState) {
		if (saved?.version !== SAVED_STATE_VERSION) {
			return;
		}
		for (const e of saved.subway.trains) {
			this.#trains.set(trainKey(e.obs), e);
		}
		for (const e of saved.bus.vehicles) {
			this.#buses.set(vehicleKey(e.obs.routeId, e.obs.vehId), e);
		}
		this.#subwayStaleSince = saved.subway.staleSince;
		for (const [routeId, t] of Object.entries(saved.bus.staleSinceByRoute)) {
			this.#busStaleSince.set(routeId, t);
		}
	}

	/** 최신 상태를 갱신하고, 새 열차와 (역, 상태)가 바뀐 열차의 관측만 돌려준다. */
	applySubway(
		obs: SubwayObservation[],
		observedAt: number
	): SubwayObservation[] {
		if (obs.length === 0) {
			this.markSourceEmpty("subway", observedAt);
			return [];
		}
		this.#subwayStaleSince = null;
		const transitions: SubwayObservation[] = [];
		for (const o of obs) {
			const key = trainKey(o);
			const before = this.#trains.get(key)?.obs;
			if (
				!before ||
				before.statnId !== o.statnId ||
				before.status !== o.status
			) {
				transitions.push(o);
			}
			this.#trains.set(key, { lastSeenAt: observedAt, obs: o });
		}
		return transitions;
	}

	/** 한 노선의 최신 상태를 갱신하고, `sourceAt`이 직전과 다른 차량의 관측만 돌려준다. */
	applyBus(
		routeId: string,
		obs: BusObservation[],
		observedAt: number
	): BusObservation[] {
		if (obs.length === 0) {
			this.markSourceEmpty({ busRouteId: routeId }, observedAt);
			return [];
		}
		this.#busStaleSince.delete(routeId);
		const fresh: BusObservation[] = [];
		for (const o of obs) {
			const key = vehicleKey(o.routeId, o.vehId);
			const before = this.#buses.get(key)?.obs;
			if (before?.sourceAt !== o.sourceAt) {
				fresh.push(o);
			}
			this.#buses.set(key, { lastSeenAt: observedAt, obs: o });
		}
		return fresh;
	}

	/** 소스가 비어 왔다. 차량은 지우지 않고, 처음 비어 온 시각만 남긴다. */
	markSourceEmpty(kind: SourceKind, observedAt: number): void {
		if (kind === "subway") {
			this.#subwayStaleSince ??= observedAt;
			return;
		}
		if (!this.#busStaleSince.has(kind.busRouteId)) {
			this.#busStaleSince.set(kind.busRouteId, observedAt);
		}
	}

	/** 마지막으로 본 지 TTL이 넘은 차량을 뺀다. */
	expire(now: number): void {
		dropExpired(this.#trains, now, SUBWAY_TTL_MS);
		dropExpired(this.#buses, now, BUS_TTL_MS);
	}

	snapshot(kind: "subway", now: number): SubwaySnapshot;
	snapshot(kind: "bus", now: number): BusSnapshot;
	snapshot(kind: "subway" | "bus", now: number): SubwaySnapshot | BusSnapshot;
	snapshot(kind: "subway" | "bus", now: number): SubwaySnapshot | BusSnapshot {
		if (kind === "subway") {
			return {
				generatedAt: now,
				staleSince: this.#subwayStaleSince,
				vehicles: sortedVehicles(this.#trains, now, SUBWAY_TTL_MS),
			};
		}
		const staleRoutes = Object.fromEntries(
			[...this.#busStaleSince.entries()].sort(([a], [b]) =>
				a < b ? -1 : Number(a > b)
			)
		);
		const times = Object.values(staleRoutes);
		return {
			generatedAt: now,
			staleRoutes,
			staleSince: times.length > 0 ? Math.min(...times) : null,
			vehicles: sortedVehicles(this.#buses, now, BUS_TTL_MS),
		};
	}

	save(): SavedState {
		return {
			bus: {
				staleSinceByRoute: Object.fromEntries(this.#busStaleSince),
				vehicles: [...this.#buses.values()],
			},
			subway: {
				staleSince: this.#subwayStaleSince,
				trains: [...this.#trains.values()],
			},
			version: SAVED_STATE_VERSION,
		};
	}

	/** Task 7 `normalizeBusPositions`의 `prev` 입력. 키는 `vehId`. */
	busPrev(routeId: string): ReadonlyMap<string, BusPrevPosition> {
		const prev = new Map<string, BusPrevPosition>();
		for (const { obs } of this.#buses.values()) {
			if (obs.routeId === routeId) {
				prev.set(obs.vehId, {
					shapeDistanceM: obs.shapeDistanceM,
					sourceAt: obs.sourceAt,
				});
			}
		}
		return prev;
	}
}

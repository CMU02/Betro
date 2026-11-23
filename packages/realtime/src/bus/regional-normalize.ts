import type { BusObservation } from "../observation";
import { type BusRouteRef, pointAlong } from "../reference";
import type { RegionalPositionRow } from "../upstream/regional-position";

/** 순번이 이 시간(밀리초)보다 오래 그대로인 차량은 멈춘 것으로 보고 뺀다. */
export const REGIONAL_FROZEN_MS = 300_000;

export interface RegionalPrev {
	lat: number | null;
	lng: number | null;
	seq: number;
	/** 순번이 마지막으로 바뀐 시각. */
	since: number;
}

function locate(
	source: "gbis" | "tago",
	row: RegionalPositionRow,
	ref: BusRouteRef,
	startM: number | null,
	flags: string[]
): { lat: number; lng: number } | null {
	if (source === "tago") {
		return row.lat !== null && row.lng !== null
			? { lat: row.lat, lng: row.lng }
			: null;
	}
	if (startM === null || !ref.coords) {
		return null;
	}
	const point = pointAlong(ref.coords, startM);
	if (point) {
		flags.push("position-from-stop");
	}
	return point;
}

/**
 * GBIS·TAGO 위치 행을 관측으로 바꾼다. 출처 수신 시각이 없어 `sourceAt`은 순번이 마지막으로
 * 바뀐 시각이고, 그 값이 {@link REGIONAL_FROZEN_MS}보다 오래된 차량은 결과에서 뺀다.
 */
export function normalizeRegionalPositions(
	routeKey: string,
	source: "gbis" | "tago",
	rows: RegionalPositionRow[],
	ref: BusRouteRef,
	prev: ReadonlyMap<string, RegionalPrev>,
	observedAt: number
): { observations: BusObservation[]; prev: Map<string, RegionalPrev> } {
	const observations: BusObservation[] = [];
	const nextPrev = new Map<string, RegionalPrev>();
	for (const row of rows) {
		const before = prev.get(row.vehId);
		const since = before && before.seq === row.seq ? before.since : observedAt;
		nextPrev.set(row.vehId, {
			lat: row.lat,
			lng: row.lng,
			seq: row.seq,
			since,
		});
		if (observedAt - since > REGIONAL_FROZEN_MS) {
			continue;
		}
		const shapeDistanceM = ref.segmentsBySeq.get(row.seq)?.startM ?? null;
		const flags: string[] = [];
		const point = locate(source, row, ref, shapeDistanceM, flags);
		if (!point) {
			continue;
		}
		flags.push("no-source-time");
		observations.push({
			busType: "",
			congestion: "",
			gpsProjectedDistanceM: null,
			lastTrip: false,
			lat: point.lat,
			lng: point.lng,
			observedAt,
			plainNo: row.plate,
			qualityFlags: flags,
			routeId: routeKey,
			sectOrd: row.seq,
			shapeDistanceM,
			sourceAt: since,
			sourceAtRaw: "",
			stopped: false,
			vehId: row.vehId,
		});
	}
	return { observations, prev: nextPrev };
}

import type { CrosswalkRow } from "../crosswalk/match";
import { normalizeStationName } from "../crosswalk/normalize-name";
import type { OsmNode } from "./osm-model";
import { STATION_WARN_OFFSET_M } from "./project";

export interface ShapeIssue {
	code:
		| "stop-order"
		| "station-offset"
		| "short-gap"
		| "long-gap"
		| "unmatched-osm-stop"
		| "no-stations";
	detail: string;
	level: "error" | "warn";
}

export interface ShapeStation {
	distanceM: number;
	offsetM: number;
	statnId: string;
}

/** 인접 역 간 거리가 이 값(미터) 미만이면 경고한다. */
const MIN_GAP_M = 300;
/** 인접 역 간 거리가 중앙값의 이 배수를 넘으면 경고한다. */
const LONG_GAP_FACTOR = 3;
const MIN_STATIONS = 2;

function stopOrderIssue(
	stations: ShapeStation[],
	osmStopOrder: string[]
): ShapeIssue | undefined {
	const distanceById = new Map(stations.map((s) => [s.statnId, s.distanceM]));
	let prev: { distanceM: number; statnId: string } | undefined;
	for (const statnId of osmStopOrder) {
		const distanceM = distanceById.get(statnId);
		if (distanceM === undefined) {
			continue;
		}
		if (prev && distanceM <= prev.distanceM) {
			return {
				code: "stop-order",
				detail: `${prev.statnId}(${Math.round(prev.distanceM)}m) -> ${statnId}(${Math.round(distanceM)}m)`,
				level: "error",
			};
		}
		prev = { distanceM, statnId };
	}
	return undefined;
}

export function validateShape(args: {
	medianGapM: number;
	osmStopOrder: string[];
	stations: ShapeStation[];
}): ShapeIssue[] {
	const { medianGapM, osmStopOrder, stations } = args;
	if (stations.length < MIN_STATIONS) {
		return [
			{
				code: "no-stations",
				detail: `stations on shape: ${stations.length}`,
				level: "error",
			},
		];
	}
	const issues: ShapeIssue[] = [];
	const orderIssue = stopOrderIssue(stations, osmStopOrder);
	if (orderIssue) {
		issues.push(orderIssue);
	}
	for (const s of stations) {
		if (s.offsetM > STATION_WARN_OFFSET_M) {
			issues.push({
				code: "station-offset",
				detail: `${s.statnId} offset ${s.offsetM.toFixed(1)}m`,
				level: "warn",
			});
		}
	}
	const sorted = [...stations].sort((a, b) => a.distanceM - b.distanceM);
	for (let i = 1; i < sorted.length; i += 1) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		if (!(prev && cur)) {
			continue;
		}
		const gap = cur.distanceM - prev.distanceM;
		const pair = `${prev.statnId}-${cur.statnId} ${Math.round(gap)}m`;
		if (gap < MIN_GAP_M) {
			issues.push({ code: "short-gap", detail: pair, level: "warn" });
		} else if (gap > LONG_GAP_FACTOR * medianGapM) {
			issues.push({ code: "long-gap", detail: pair, level: "warn" });
		}
	}
	return issues;
}

/**
 * OSM 정차 노드를 역에 잇는다. tags.ref가 frCode와 같으면 그 역,
 * 아니면 정규화한 이름이 nameCanonical 또는 nameAliases와 같은 역.
 * 어느 쪽도 아니면 결과에서 빠지며, 호출자가 unmatched-osm-stop을 낸다.
 */
export function matchOsmStops(
	stops: OsmNode[],
	candidates: CrosswalkRow[]
): { osmNodeId: number; statnId: string }[] {
	const byFrCode = new Map<string, string>();
	const byName = new Map<string, string>();
	for (const c of candidates) {
		if (c.frCode) {
			byFrCode.set(c.frCode, c.statnId);
		}
		for (const name of [c.nameCanonical, ...c.nameAliases]) {
			const key = normalizeStationName(name);
			if (!byName.has(key)) {
				byName.set(key, c.statnId);
			}
		}
	}
	const result: { osmNodeId: number; statnId: string }[] = [];
	for (const stop of stops) {
		const ref = stop.tags?.ref;
		const name = stop.tags?.name;
		const statnId =
			(ref ? byFrCode.get(ref) : undefined) ??
			(name ? byName.get(normalizeStationName(name)) : undefined);
		if (statnId) {
			result.push({ osmNodeId: stop.id, statnId });
		}
	}
	return result;
}

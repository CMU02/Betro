import type { CrosswalkRow } from "../crosswalk/match";
import { normalizeStationName } from "../crosswalk/normalize-name";
import type { OsmNode } from "./osm-model";

export interface ShapeIssue {
	code:
		| "stop-order"
		| "station-offset"
		| "short-gap"
		| "long-gap"
		| "unmatched-osm-stop"
		| "stop-anchor-rejected"
		| "stop-ref-conflict"
		| "no-stations";
	detail: string;
	level: "error" | "warn";
}

export interface ShapeStation {
	distanceM: number;
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

/** 역 수, OSM 정차 순서, 인접 역 간격을 검사한다. 선로와 역 좌표 사이 거리(station-offset)는 placeStations가 본다. */
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

interface CandidateIndex {
	byFrCode: Map<string, string>;
	byId: Map<string, CrosswalkRow>;
	byName: Map<string, string>;
}

function indexCandidates(candidates: CrosswalkRow[]): CandidateIndex {
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
	return {
		byFrCode,
		byId: new Map(candidates.map((c) => [c.statnId, c])),
		byName,
	};
}

interface StopResolution {
	/** 이름과 ref가 가리키는 역이 다르면 그 내용(경고 detail). */
	conflict?: string;
	statnId?: string;
}

const REF_SEPARATOR = ";";
const LEADING_ZEROS = /^([A-Z]*)0+(?=\d)/;

/** ref·frCode 비교용 표기: 대문자, 영문 접두 뒤 앞자리 0 제거(D08 → D8). */
const canonicalRef = (value: string): string =>
	value.trim().toUpperCase().replace(LEADING_ZEROS, "$1");

/** OSM ref(여러 값이면 ;로 구분)에 frCode가 들어 있으면 true. */
function refContains(ref: string, frCode: string): boolean {
	const target = canonicalRef(frCode);
	return ref.split(REF_SEPARATOR).some((part) => canonicalRef(part) === target);
}

const describeStation = (idx: CandidateIndex, statnId: string): string =>
	`${statnId} ${idx.byId.get(statnId)?.nameCanonical ?? ""}`.trim();

/**
 * 정차 노드 하나를 역에 잇는다. 정규화한 이름이 nameCanonical 또는 nameAliases와 같은 역이 먼저이고,
 * 이름으로 못 찾을 때만 tags.ref = frCode인 역을 쓴다.
 * 이름이 가리키는 역과 ref가 맞지 않으면(ref가 다른 역의 frCode이거나 그 역의 frCode를 담고 있지 않으면) conflict를 남긴다.
 * frCode 비교는 ;로 나눈 여러 값과 앞자리 0 차이를 같은 것으로 본다. ref로 역을 찾을 때는 ref 문자열을 그대로 쓴다.
 */
function resolveStop(stop: OsmNode, idx: CandidateIndex): StopResolution {
	const ref = stop.tags?.ref;
	const name = stop.tags?.name;
	const byName = name ? idx.byName.get(normalizeStationName(name)) : undefined;
	const byRef = ref ? idx.byFrCode.get(ref) : undefined;
	if (!byName) {
		return { statnId: byRef };
	}
	if (byRef && byRef !== byName) {
		return {
			conflict: `node ${stop.id} ${name} ref ${ref}: ref points to ${describeStation(idx, byRef)} but name points to ${describeStation(idx, byName)}; ref match rejected`,
			statnId: byName,
		};
	}
	const frCode = idx.byId.get(byName)?.frCode;
	if (ref && frCode && !refContains(ref, frCode)) {
		return {
			conflict: `node ${stop.id} ${name} ref ${ref}: name points to ${describeStation(idx, byName)} whose frCode is ${frCode}`,
			statnId: byName,
		};
	}
	return { statnId: byName };
}

/**
 * OSM 정차 노드를 역에 잇는다. 이름(nameCanonical·nameAliases)이 먼저이고, 이름으로 못 찾으면 tags.ref = frCode.
 * 어느 쪽도 아니면 결과에서 빠지며, 호출자가 unmatched-osm-stop을 낸다.
 */
export function matchOsmStops(
	stops: OsmNode[],
	candidates: CrosswalkRow[]
): { osmNodeId: number; statnId: string }[] {
	const idx = indexCandidates(candidates);
	const result: { osmNodeId: number; statnId: string }[] = [];
	for (const stop of stops) {
		const { statnId } = resolveStop(stop, idx);
		if (statnId) {
			result.push({ osmNodeId: stop.id, statnId });
		}
	}
	return result;
}

/** 이름과 ref가 서로 다른 역을 가리키는 정차 노드마다 stop-ref-conflict 경고를 낸다(노드당 한 번). */
export function stopRefConflicts(
	stops: OsmNode[],
	candidates: CrosswalkRow[]
): ShapeIssue[] {
	const idx = indexCandidates(candidates);
	const seen = new Set<number>();
	const issues: ShapeIssue[] = [];
	for (const stop of stops) {
		if (seen.has(stop.id)) {
			continue;
		}
		seen.add(stop.id);
		const { conflict } = resolveStop(stop, idx);
		if (conflict) {
			issues.push({
				code: "stop-ref-conflict",
				detail: conflict,
				level: "warn",
			});
		}
	}
	return issues;
}

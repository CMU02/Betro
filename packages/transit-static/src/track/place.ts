import type { TrackStationAnchor } from "@Betro/db/schema/transit";
import { distance } from "@turf/distance";
import type { CrosswalkRow } from "../crosswalk/match";
import type { OsmNode } from "./osm-model";
import {
	projectPoint,
	STATION_MAX_OFFSET_M,
	STATION_WARN_OFFSET_M,
} from "./project";
import type { LngLat } from "./stitch";
import { matchOsmStops, type ShapeIssue } from "./validate";

/** OSM 정차 노드가 역사마스터 좌표에서 이 거리(미터)보다 멀면 이름 오매칭으로 보고 쓰지 않는다. */
export const STOP_ANCHOR_MAX_OFFSET_M = 2000;

export interface PlacedStation {
	anchor: TrackStationAnchor;
	/** 선 시작점에서 역까지 선을 따라 잰 거리(미터). */
	distanceM: number;
	/** 역사마스터 좌표에서 역을 놓은 지점까지의 거리(미터). osm-stop이면 그 노드까지. */
	offsetM: number;
	osmStopNodeId?: number;
	statnId: string;
}

export interface PlacementResult {
	/** station-offset, stop-anchor-rejected 경고. */
	issues: ShapeIssue[];
	/** 이 shape의 OSM 정차 노드 중 노선 역과 이어진 것(relation 순서). */
	matches: { osmNodeId: number; statnId: string }[];
	/** 어느 방식으로도 놓지 못한 역과 역사마스터 좌표의 선까지 거리. */
	offShape: { offsetM: number; statnId: string }[];
	/** 놓인 역. distanceM 오름차순. 한 역은 한 번만 들어간다. */
	onShape: PlacedStation[];
	/** 순서 검사용: 채택된 정차 노드의 역을 relation 순서대로, 역마다 한 번. */
	stopOrder: string[];
}

export interface PlaceStationsInput {
	/** 닫힌 선이면 커서 뒤에서 못 찾은 정차 노드를 처음부터 한 번 더 찾는다. */
	closed: boolean;
	coords: LngLat[];
	/** coords와 나란한 OSM 노드 id 열. */
	nodeIds: number[];
	/** 이 노선의 crosswalk 역. */
	stations: CrosswalkRow[];
	/** relation의 정차 노드(멤버 순서 그대로). */
	stops: OsmNode[];
}

const metersBetween = (a: LngLat, b: LngLat): number =>
	distance(a, b, { units: "meters" });

const masterOf = (station: CrosswalkRow): LngLat => [station.lng, station.lat];

/** coords의 각 점까지 선을 따라 잰 누적 거리(미터). */
function cumulativeDistances(coords: LngLat[]): number[] {
	const result: number[] = [];
	let total = 0;
	let prev: LngLat | undefined;
	for (const coord of coords) {
		if (prev) {
			total += metersBetween(prev, coord);
		}
		result.push(total);
		prev = coord;
	}
	return result;
}

/** cursor 이후 nodeId의 첫 등장. 닫힌 선이면 못 찾았을 때 처음부터 한 번 더 찾는다. */
function findNodeIndex(
	nodeIds: number[],
	nodeId: number,
	cursor: number,
	closed: boolean
): number | undefined {
	const ahead = nodeIds.indexOf(nodeId, cursor);
	if (ahead >= 0) {
		return ahead;
	}
	if (!closed) {
		return;
	}
	const wrapped = nodeIds.indexOf(nodeId);
	return wrapped >= 0 ? wrapped : undefined;
}

interface StopCandidate {
	index?: number;
	placed: PlacedStation;
}

interface LineContext {
	closed: boolean;
	coords: LngLat[];
	cumulative: number[];
	nodeIds: number[];
}

/** 정차 노드 하나로 역을 놓아 본다. 노드가 선 위에 있으면 osm-stop, 아니면 150m 이내 투영일 때 osm-stop-projected. */
function stopCandidate(
	line: LineContext,
	stop: OsmNode,
	station: CrosswalkRow,
	cursor: number
): StopCandidate | undefined {
	const nodeCoord: LngLat = [stop.lon, stop.lat];
	const index = findNodeIndex(line.nodeIds, stop.id, cursor, line.closed);
	const distanceAt = index === undefined ? undefined : line.cumulative[index];
	if (index !== undefined && distanceAt !== undefined) {
		return {
			index,
			placed: {
				anchor: "osm-stop",
				distanceM: distanceAt,
				offsetM: metersBetween(masterOf(station), nodeCoord),
				osmStopNodeId: stop.id,
				statnId: station.statnId,
			},
		};
	}
	const projected = projectPoint(line.coords, nodeCoord);
	if (projected.offsetM > STATION_MAX_OFFSET_M) {
		return;
	}
	return {
		placed: {
			anchor: "osm-stop-projected",
			distanceM: projected.distanceM,
			offsetM: metersBetween(masterOf(station), projected.snapped),
			osmStopNodeId: stop.id,
			statnId: station.statnId,
		},
	};
}

function rejectedStopIssue(
	station: CrosswalkRow,
	stop: OsmNode,
	order: number,
	reason: string
): ShapeIssue {
	return {
		code: "stop-anchor-rejected",
		detail: `${station.statnId} ${station.nameCanonical}: stop #${order} node ${stop.id} ${stop.tags?.name ?? "(이름 없음)"} ${reason}`,
		level: "warn",
	};
}

/**
 * 역사마스터 좌표에서 STATION_MAX_OFFSET_M 이내인 정차 노드가 하나라도 매칭된 역.
 * 이런 역은 그보다 먼 다른 정차 노드(OSM ref가 밀린 이웃 역 노드 등)로 놓지 않는다.
 */
function stationsWithNearStop(
	stops: OsmNode[],
	statnIdByNode: Map<number, string>,
	byStatnId: Map<string, CrosswalkRow>
): Set<string> {
	const near = new Set<string>();
	for (const stop of stops) {
		const station = byStatnId.get(statnIdByNode.get(stop.id) ?? "");
		if (
			station &&
			metersBetween(masterOf(station), [stop.lon, stop.lat]) <=
				STATION_MAX_OFFSET_M
		) {
			near.add(station.statnId);
		}
	}
	return near;
}

type StopAttempt =
	| { kind: "placed"; candidate: StopCandidate }
	| { kind: "rejected"; reason: string }
	| { kind: "none" };

/**
 * 정차 노드 하나로 역을 놓아 본다(1·2단계). 같은 역에 150m 안의 다른 정차 노드가 있는데 이 노드가 150m 밖이거나,
 * 놓은 지점이 역사마스터 좌표에서 2000m 넘게 떨어지면 버린다.
 */
function anchorOnStop(
	line: LineContext,
	stop: OsmNode,
	station: CrosswalkRow,
	cursor: number,
	hasNearStop: boolean
): StopAttempt {
	const nodeOffsetM = metersBetween(masterOf(station), [stop.lon, stop.lat]);
	if (hasNearStop && nodeOffsetM > STATION_MAX_OFFSET_M) {
		return {
			kind: "rejected",
			reason: `${nodeOffsetM.toFixed(0)}m from master, another stop node is within ${STATION_MAX_OFFSET_M}m`,
		};
	}
	const candidate = stopCandidate(line, stop, station, cursor);
	if (!candidate) {
		return { kind: "none" };
	}
	if (candidate.placed.offsetM > STOP_ANCHOR_MAX_OFFSET_M) {
		return {
			kind: "rejected",
			reason: `${candidate.placed.offsetM.toFixed(0)}m from master`,
		};
	}
	return { candidate, kind: "placed" };
}

/** 아직 놓이지 않은 역을 역사마스터 좌표로 투영해 놓고(3단계), 150m 밖인 역을 돌려준다. */
function placeOnMaster(
	coords: LngLat[],
	stations: CrosswalkRow[],
	placed: Map<string, PlacedStation>
): PlacementResult["offShape"] {
	const offShape: PlacementResult["offShape"] = [];
	for (const station of stations) {
		if (placed.has(station.statnId)) {
			continue;
		}
		const { distanceM, offsetM } = projectPoint(coords, masterOf(station));
		if (offsetM <= STATION_MAX_OFFSET_M) {
			placed.set(station.statnId, {
				anchor: "station-master",
				distanceM,
				offsetM,
				statnId: station.statnId,
			});
		} else {
			offShape.push({ offsetM, statnId: station.statnId });
		}
	}
	return offShape;
}

function stationOffsetIssue(s: PlacedStation): ShapeIssue | undefined {
	if (s.offsetM <= STATION_WARN_OFFSET_M) {
		return;
	}
	return {
		code: "station-offset",
		detail: `${s.statnId} offset ${s.offsetM.toFixed(1)}m (${s.anchor})`,
		level: "warn",
	};
}

/**
 * 노선의 crosswalk 역을 선 위에 놓는다. 역마다 아래 순서로 시도한다.
 * 1. osm-stop: relation 정차 노드와 매칭되고 그 노드가 선의 노드 열에 있으면 그 노드의 누적 거리.
 *    정차 노드는 relation 순서대로 보며, 같은 노드가 여러 번 나오면 커서 이후 첫 등장을 고른다.
 * 2. osm-stop-projected: 매칭된 노드가 선 위에 없으면 그 노드를 선에 투영(150m 이내).
 *    1·2단계는 역사마스터 좌표에서 2000m 넘게 떨어지면 버리고 stop-anchor-rejected를 남긴다.
 *    한 역에 서로 다른 정차 노드가 여럿 매칭되고 그중 150m 이내인 노드가 있으면, 150m 넘는 노드도
 *    stop-anchor-rejected로 버린다(가까운 노드끼리는 relation 순서를 따른다).
 * 3. station-master: 역사마스터 좌표를 선에 투영(150m 이내).
 * 셋 다 안 되면 offShape에 남는다.
 */
export function placeStations({
	closed,
	coords,
	nodeIds,
	stations,
	stops,
}: PlaceStationsInput): PlacementResult {
	const line: LineContext = {
		closed,
		coords,
		cumulative: cumulativeDistances(coords),
		nodeIds,
	};
	const byStatnId = new Map(stations.map((s) => [s.statnId, s]));
	const matches = matchOsmStops(stops, stations);
	const statnIdByNode = new Map(matches.map((m) => [m.osmNodeId, m.statnId]));
	const nearStop = stationsWithNearStop(stops, statnIdByNode, byStatnId);
	const placed = new Map<string, PlacedStation>();
	const issues: ShapeIssue[] = [];
	const stopOrder: string[] = [];
	let cursor = 0;

	for (const [i, stop] of stops.entries()) {
		const station = byStatnId.get(statnIdByNode.get(stop.id) ?? "");
		if (!station || placed.has(station.statnId)) {
			continue;
		}
		const attempt = anchorOnStop(
			line,
			stop,
			station,
			cursor,
			nearStop.has(station.statnId)
		);
		if (attempt.kind === "rejected") {
			issues.push(rejectedStopIssue(station, stop, i, attempt.reason));
		} else if (attempt.kind === "placed") {
			placed.set(station.statnId, attempt.candidate.placed);
			stopOrder.push(station.statnId);
			cursor = attempt.candidate.index ?? cursor;
		}
	}

	const offShape = placeOnMaster(coords, stations, placed);
	const onShape = [...placed.values()].sort(
		(a, b) => a.distanceM - b.distanceM
	);
	for (const s of onShape) {
		const issue = stationOffsetIssue(s);
		if (issue) {
			issues.push(issue);
		}
	}
	return { issues, matches, offShape, onShape, stopOrder };
}

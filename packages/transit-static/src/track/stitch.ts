import { distance } from "@turf/distance";
import type { OsmIndex, OsmWay } from "./osm-model";

export type LngLat = [number, number];

export type StitchResult =
	| { ok: true; coords: LngLat[] }
	| {
			ok: false;
			reason: "gap" | "empty" | "missing-node";
			atWayId?: number;
			gapM?: number;
	  };

/** 끝점 노드 id가 달라도 이 거리(미터) 이내면 같은 위치로 보고 잇는다. */
export const GAP_TOLERANCE_M = 1;

interface Vertex {
	coord: LngLat;
	id: number;
}

const metersBetween = (a: Vertex, b: Vertex): number =>
	distance(a.coord, b.coord, { units: "meters" });

function resolveWay(way: OsmWay, idx: OsmIndex): Vertex[] | undefined {
	const vertices: Vertex[] = [];
	for (const id of way.nodes) {
		const node = idx.nodes.get(id);
		if (!node) {
			return;
		}
		vertices.push({ coord: [node.lon, node.lat], id });
	}
	return vertices;
}

/** 첫 way를 두 번째 way 쪽으로 향하게 한다. 공유 노드 id가 우선이고, 없으면 끝점 거리로 정한다. */
function orientFirst(first: Vertex[], second: Vertex[]): Vertex[] {
	const [head] = first;
	const tail = first.at(-1);
	const ends = [second[0], second.at(-1)].filter(
		(v): v is Vertex => v !== undefined
	);
	if (!(head && tail) || ends.length === 0) {
		return first;
	}
	if (ends.some((v) => v.id === tail.id)) {
		return first;
	}
	if (ends.some((v) => v.id === head.id)) {
		return [...first].reverse();
	}
	const nearest = (from: Vertex) =>
		Math.min(...ends.map((v) => metersBetween(from, v)));
	return nearest(head) < nearest(tail) ? [...first].reverse() : first;
}

type Attach = { ok: true; vertices: Vertex[] } | { ok: false; gapM: number };

/** 현재 선의 끝점에 다음 way를 붙일 방향을 정하고, 공유 지점을 뺀 나머지 정점을 돌려준다. */
function attach(end: Vertex, next: Vertex[]): Attach {
	const [start] = next;
	const last = next.at(-1);
	if (!(start && last)) {
		return { ok: true, vertices: [] };
	}
	if (start.id === end.id) {
		return { ok: true, vertices: next.slice(1) };
	}
	if (last.id === end.id) {
		return { ok: true, vertices: [...next].reverse().slice(1) };
	}
	const toStart = metersBetween(end, start);
	const toLast = metersBetween(end, last);
	const gapM = Math.min(toStart, toLast);
	if (gapM > GAP_TOLERANCE_M) {
		return { gapM, ok: false };
	}
	const oriented = toStart <= toLast ? next : [...next].reverse();
	return { ok: true, vertices: oriented.slice(1) };
}

/**
 * 순서대로 놓인 OSM way들을 하나의 선으로 잇는다.
 * 끝점이 노드 id로도, GAP_TOLERANCE_M 이내 거리로도 이어지지 않으면 건너뛰지 않고 gap으로 실패한다.
 */
export function stitchWays(ways: OsmWay[], idx: OsmIndex): StitchResult {
	if (ways.length === 0) {
		return { ok: false, reason: "empty" };
	}
	const resolved: { vertices: Vertex[]; wayId: number }[] = [];
	for (const way of ways) {
		const vertices = resolveWay(way, idx);
		if (!vertices) {
			return { atWayId: way.id, ok: false, reason: "missing-node" };
		}
		resolved.push({ vertices, wayId: way.id });
	}
	const [first, ...rest] = resolved;
	if (!first) {
		return { ok: false, reason: "empty" };
	}
	const line = rest[0]
		? [...orientFirst(first.vertices, rest[0].vertices)]
		: [...first.vertices];
	for (const { vertices, wayId } of rest) {
		const end = line.at(-1);
		if (!end) {
			line.push(...vertices);
			continue;
		}
		const joined = attach(end, vertices);
		if (!joined.ok) {
			return { atWayId: wayId, gapM: joined.gapM, ok: false, reason: "gap" };
		}
		line.push(...joined.vertices);
	}
	return { coords: line.map((v) => v.coord), ok: true };
}

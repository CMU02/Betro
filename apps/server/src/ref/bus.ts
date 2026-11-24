import { SOURCE_TIMEZONE } from "@Betro/commute/sources/seoul-bus";
import type { Database } from "@Betro/db";
import { and, asc, eq, sql } from "@Betro/db/operators";
import {
	type BusRegion,
	busRoute,
	busRouteStop,
	referenceBatch,
} from "@Betro/db/schema/transit";
import { busLine, busStop, parseBusRef } from "./ids";

export interface BusRouteMatch {
	areaName: string | null;
	line: string;
	name: string;
	region: BusRegion;
	routeType: string;
	shortName: string;
}

export interface BusRouteStopView {
	arsId: string | null;
	directionName: string | null;
	name: string;
	seq: number;
	stop: string;
}

export interface BusRouteDetail {
	areaName: string | null;
	line: string;
	name: string;
	region: BusRegion;
	shortName: string;
	stops: BusRouteStopView[];
}

async function currentBusBatchId(db: Database): Promise<number | null> {
	const [row] = await db
		.select({ id: referenceBatch.id })
		.from(referenceBatch)
		.where(
			and(
				eq(referenceBatch.kind, "bus_route"),
				eq(referenceBatch.isCurrent, true)
			)
		)
		.limit(1);
	return row?.id ?? null;
}

/** 현재 버스 배치의 번호. 현재 배치가 없으면 null. */
export function currentBusBatch(db: Database): Promise<number | null> {
	return currentBusBatchId(db);
}

/** 서울 출처 서울 면허 노선(마을버스 포함)만 거르는 조건. 경기·인천 면허 노선은 서울 출처여도 뺀다. */
export function seoulRouteWhere(batchId: number) {
	return and(
		eq(busRoute.batchId, batchId),
		eq(busRoute.source, "seoul"),
		eq(busRoute.region, "seoul")
	);
}

const MATCH_EXACT = 0;
const MATCH_PREFIX = 1;
const MATCH_OTHER = 2;

/**
 * 현재 배치에서 `short_name`이나 `route_name`에 검색어가 든 노선을 찾는다.
 * 검색어는 바인딩으로 넘기고, `instr`로 찾아 `%`·`_`가 와일드카드가 되지 않게 한다.
 */
export async function searchBusRoutes(
	db: Database,
	{ limit, q }: { limit: number; q: string }
): Promise<{ batchId: number; routes: BusRouteMatch[] } | null> {
	const batchId = await currentBusBatchId(db);
	if (batchId === null) {
		return null;
	}
	const needle = sql`lower(${q})`;
	const shortLower = sql`lower(${busRoute.shortName})`;
	const matchRank = sql`case
		when ${shortLower} = ${needle} then ${MATCH_EXACT}
		when instr(${shortLower}, ${needle}) = 1 then ${MATCH_PREFIX}
		else ${MATCH_OTHER} end`;
	const regionRank = sql`case ${busRoute.region}
		when 'seoul' then 0 when 'gyeonggi' then 1 else 2 end`;
	const rows = await db
		.select({
			areaName: busRoute.areaName,
			name: busRoute.routeName,
			region: busRoute.region,
			routeId: busRoute.routeId,
			routeType: busRoute.routeType,
			shortName: busRoute.shortName,
			source: busRoute.source,
		})
		.from(busRoute)
		.where(
			and(
				eq(busRoute.batchId, batchId),
				sql`(instr(${shortLower}, ${needle}) > 0 or instr(lower(${busRoute.routeName}), ${needle}) > 0)`
			)
		)
		.orderBy(
			matchRank,
			regionRank,
			asc(busRoute.shortName),
			asc(busRoute.areaName),
			asc(busRoute.routeName),
			asc(busRoute.source),
			asc(busRoute.routeId)
		)
		.limit(limit);
	return {
		batchId,
		routes: rows.map(({ routeId, source, ...rest }) => ({
			line: busLine(source, routeId),
			...rest,
		})),
	};
}

/**
 * 현재 배치의 노선과 그 정류장(순번 순). 노선이 없으면 `route`가 null.
 * `busRef`는 출처 접두사가 붙은 ID이고, 접두사가 없으면 서울 노선이다.
 */
export async function findBusRouteStops(
	db: Database,
	busRef: string
): Promise<{ batchId: number; route: BusRouteDetail | null } | null> {
	const batchId = await currentBusBatchId(db);
	if (batchId === null) {
		return null;
	}
	const { id: routeId, source } = parseBusRef(busRef);
	const [route] = await db
		.select({
			areaName: busRoute.areaName,
			id: busRoute.id,
			name: busRoute.routeName,
			region: busRoute.region,
			routeId: busRoute.routeId,
			shortName: busRoute.shortName,
			source: busRoute.source,
		})
		.from(busRoute)
		.where(
			and(
				eq(busRoute.batchId, batchId),
				eq(busRoute.source, source),
				eq(busRoute.routeId, routeId)
			)
		)
		.limit(1);
	if (!route) {
		return { batchId, route: null };
	}
	const stops = await db
		.select({
			arsId: busRouteStop.arsId,
			directionName: busRouteStop.directionName,
			name: busRouteStop.name,
			seq: busRouteStop.seq,
			stationId: busRouteStop.stationId,
		})
		.from(busRouteStop)
		.where(eq(busRouteStop.busRouteId, route.id))
		.orderBy(asc(busRouteStop.seq));
	return {
		batchId,
		route: {
			areaName: route.areaName,
			line: busLine(route.source, route.routeId),
			name: route.name,
			region: route.region,
			shortName: route.shortName,
			stops: stops.map(({ stationId, ...rest }) => ({
				...rest,
				stop: busStop(route.source, stationId),
			})),
		},
	};
}

export interface StopRouteView {
	directionName: string | null;
	firstBusMinute: number | null;
	headwayMin: number | null;
	lastBusMinute: number | null;
	line: string;
	nextStopName: string | null;
	routeType: string;
	seq: number;
	shortName: string;
}

export interface StopRoutes {
	arsId: string | null;
	lat: number;
	lng: number;
	name: string;
	routes: StopRouteView[];
	stop: string;
	timezone: string;
}

/**
 * 서울 정류장(`seoul-bus:<stationId>`)을 지나는 서울 노선과 각 노선의 다음 정류장 이름.
 * 서울 출처가 아니거나 서울 노선이 하나도 없으면 `result`가 null이다. 현재 배치가 없으면 null.
 */
export async function findStopRoutes(
	db: Database,
	stop: string
): Promise<{ batchId: number; result: StopRoutes | null } | null> {
	const batchId = await currentBusBatchId(db);
	if (batchId === null) {
		return null;
	}
	const { id: stationId, source } = parseBusRef(stop);
	if (source !== "seoul" || !stop.startsWith("seoul-bus:")) {
		return { batchId, result: null };
	}
	const rows = await db
		.select({
			arsId: busRouteStop.arsId,
			directionName: busRouteStop.directionName,
			firstBusMinute: busRoute.firstBusMinute,
			headwayMin: busRoute.headwayMin,
			lastBusMinute: busRoute.lastBusMinute,
			lat: busRouteStop.lat,
			lng: busRouteStop.lng,
			name: busRouteStop.name,
			nextStopName: sql<
				string | null
			>`(select n.name from bus_route_stop n where n.bus_route_id = ${busRouteStop.busRouteId} and n.seq = ${busRouteStop.seq} + 1)`,
			routeId: busRoute.routeId,
			routeType: busRoute.routeType,
			seq: busRouteStop.seq,
			shortName: busRoute.shortName,
			source: busRoute.source,
		})
		.from(busRouteStop)
		.innerJoin(busRoute, eq(busRoute.id, busRouteStop.busRouteId))
		.where(and(seoulRouteWhere(batchId), eq(busRouteStop.stationId, stationId)))
		.orderBy(
			asc(busRoute.shortName),
			asc(busRoute.routeId),
			asc(busRouteStop.seq)
		);
	const [first] = rows;
	if (!first) {
		return { batchId, result: null };
	}
	return {
		batchId,
		result: {
			arsId: first.arsId,
			lat: first.lat,
			lng: first.lng,
			name: first.name,
			routes: rows.map((row) => ({
				directionName: row.directionName,
				firstBusMinute: row.firstBusMinute,
				headwayMin: row.headwayMin,
				lastBusMinute: row.lastBusMinute,
				line: busLine(row.source, row.routeId),
				nextStopName: row.nextStopName,
				routeType: row.routeType,
				seq: row.seq,
				shortName: row.shortName,
			})),
			stop: busStop("seoul", stationId),
			timezone: SOURCE_TIMEZONE,
		},
	};
}

/** 07 제목·배지 색·즐겨찾기에 쓰는 서울 노선 정보. */
export interface SeoulBusRouteInfo {
	name: string;
	routeType: string;
	shortName: string;
}

/**
 * 현재 배치에서 서울 노선(`seoulRouteWhere`) 하나를 접두사 없는 노선 ID로 찾는다. 없거나 서울 노선이
 * 아니면(경기·인천 면허 포함) `route`가 null이다. 현재 배치가 없으면 null.
 */
export async function findSeoulBusRoute(
	db: Database,
	routeId: string
): Promise<{ batchId: number; route: SeoulBusRouteInfo | null } | null> {
	const batchId = await currentBusBatchId(db);
	if (batchId === null) {
		return null;
	}
	const [row] = await db
		.select({
			name: busRoute.routeName,
			routeType: busRoute.routeType,
			shortName: busRoute.shortName,
		})
		.from(busRoute)
		.where(and(seoulRouteWhere(batchId), eq(busRoute.routeId, routeId)))
		.limit(1);
	return { batchId, route: row ?? null };
}

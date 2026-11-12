import type { Database } from "@Betro/db";
import { and, asc, eq, sql } from "@Betro/db/operators";
import {
	type BusRegion,
	busRoute,
	busRouteStop,
	referenceBatch,
} from "@Betro/db/schema/transit";
import { busLine, busStop } from "./ids";

export interface BusRouteMatch {
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
			name: busRoute.routeName,
			region: busRoute.region,
			routeId: busRoute.routeId,
			routeType: busRoute.routeType,
			shortName: busRoute.shortName,
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
			asc(busRoute.routeName),
			asc(busRoute.routeId)
		)
		.limit(limit);
	return {
		batchId,
		routes: rows.map(({ routeId, ...rest }) => ({
			line: busLine(routeId),
			...rest,
		})),
	};
}

/** 현재 배치의 노선과 그 정류장(순번 순). 노선이 없으면 `route`가 null. */
export async function findBusRouteStops(
	db: Database,
	busRouteId: string
): Promise<{ batchId: number; route: BusRouteDetail | null } | null> {
	const batchId = await currentBusBatchId(db);
	if (batchId === null) {
		return null;
	}
	const [route] = await db
		.select({
			id: busRoute.id,
			name: busRoute.routeName,
			region: busRoute.region,
			routeId: busRoute.routeId,
			shortName: busRoute.shortName,
		})
		.from(busRoute)
		.where(and(eq(busRoute.batchId, batchId), eq(busRoute.routeId, busRouteId)))
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
			line: busLine(route.routeId),
			name: route.name,
			region: route.region,
			shortName: route.shortName,
			stops: stops.map(({ stationId, ...rest }) => ({
				...rest,
				stop: busStop(stationId),
			})),
		},
	};
}

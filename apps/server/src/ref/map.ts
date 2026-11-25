import type { Database } from "@Betro/db";
import { and, asc, eq, sql } from "@Betro/db/operators";
import {
	busRoute,
	busRouteShape,
	busRouteStop,
	type ReferenceBatchKind,
	referenceBatch,
	stationCrosswalk,
	type TrackDirection,
	timetableStopTime,
	timetableTrip,
	trackShape,
	trackStation,
} from "@Betro/db/schema/transit";
import type { LineKey } from "@Betro/transit-static/lines";
import { Hono } from "hono";
import { currentBusBatch } from "./bus";
import {
	busLine,
	busStop,
	parseBusRef,
	stripSubwayPrefix,
	subwayLine,
	subwayStation,
} from "./ids";
import { ifNoneMatchMatches } from "./if-none-match";
import { currentTrackBatch, findLineKey } from "./subway";

const CACHE_CONTROL = "public, max-age=86400";
const MIDDLE_DIVISOR = 2;
/**
 * 버스 지도 응답 형식의 판. 필드를 더하면 올려서, 예전 응답을 저장해 둔 앱이 같은 배치라도 새로 받게 한다.
 * 2: 정류장별 진행 방면(`directionName`).
 */
const BUS_MAP_FORMAT = 2;

type LngLat = [number, number];

export interface BusMapStop {
	arsId: string | null;
	/** 이 정류장에서 차량이 가는 방면(서울 노선 정보). 왕복 노선은 마지막 정류장이 출발지라 이 값을 쓴다. */
	directionName: string | null;
	lat: number;
	lng: number;
	name: string;
	seq: number;
	stop: string;
}

export interface BusMap {
	batchId: number;
	line: string;
	shape: LngLat[];
	stops: BusMapStop[];
}

export interface SubwayMapStation {
	lat: number;
	lng: number;
	name: string;
	nextRunSec: number | null;
	offsetM: number;
	seq: number;
	stop: string;
}

export interface SubwayMapBranch {
	branchKey: string;
	direction: TrackDirection;
	shape: LngLat[];
	stations: SubwayMapStation[];
}

export interface SubwayMap {
	batchId: number;
	branches: SubwayMapBranch[];
	line: string;
}

export interface SubwayStationPoint {
	lat: number;
	line: string;
	lng: number;
	name: string;
	stop: string;
}

async function currentBatchOf(
	db: Database,
	kind: ReferenceBatchKind
): Promise<number | null> {
	const [row] = await db
		.select({ id: referenceBatch.id })
		.from(referenceBatch)
		.where(
			and(eq(referenceBatch.kind, kind), eq(referenceBatch.isCurrent, true))
		)
		.limit(1);
	return row?.id ?? null;
}

/** 현재 배치의 노선 선과 정류장(순번 순). 배치가 없으면 null, 노선이 없으면 `map`이 null. */
export async function findBusMap(
	db: Database,
	busRef: string,
	isNotModified: (batchId: number) => boolean
): Promise<{
	batchId: number;
	map: BusMap | null;
	notModified: boolean;
} | null> {
	const batchId = await currentBusBatch(db);
	if (batchId === null) {
		return null;
	}
	const { id: routeId, source } = parseBusRef(busRef);
	const [route] = await db
		.select({
			id: busRoute.id,
			routeId: busRoute.routeId,
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
		return { batchId, map: null, notModified: false };
	}
	if (isNotModified(batchId)) {
		return { batchId, map: null, notModified: true };
	}
	const [shape] = await db
		.select({ coords: busRouteShape.coords })
		.from(busRouteShape)
		.where(eq(busRouteShape.busRouteId, route.id))
		.limit(1);
	const stops = await db
		.select({
			arsId: busRouteStop.arsId,
			directionName: busRouteStop.directionName,
			lat: busRouteStop.lat,
			lng: busRouteStop.lng,
			name: busRouteStop.name,
			seq: busRouteStop.seq,
			stationId: busRouteStop.stationId,
		})
		.from(busRouteStop)
		.where(eq(busRouteStop.busRouteId, route.id))
		.orderBy(asc(busRouteStop.seq));
	return {
		batchId,
		map: {
			batchId,
			line: busLine(route.source, route.routeId),
			shape: shape?.coords ?? [],
			stops: stops.map(({ stationId, ...rest }) => ({
				...rest,
				stop: busStop(route.source, stationId),
			})),
		},
		notModified: false,
	};
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / MIDDLE_DIVISOR);
	const upper = sorted[mid] ?? 0;
	if (sorted.length % MIDDLE_DIVISOR === 1) {
		return upper;
	}
	return Math.round(((sorted[mid - 1] ?? upper) + upper) / MIDDLE_DIVISOR);
}

/**
 * 현재 시간표 배치의 평일 열차에서 이웃한 두 정차(`seq`가 연속) 사이 소요시간(초)을 모은다.
 * 급행이 건너뛴 역 쌍은 선로 위 이웃 역과 맞지 않아 나중에 걸러진다. 키는 `${from}>${to}`.
 */
async function loadRunTimes(
	db: Database,
	timetableBatchId: number,
	lineKey: LineKey
): Promise<Map<string, Map<TrackDirection, number[]>>> {
	const next = sql`next_stop`;
	const rows = await db.all<{
		direction: TrackDirection;
		fromStatn: string;
		runSec: number;
		toStatn: string;
	}>(sql`
		select t.direction as direction,
			a.statn_id as fromStatn,
			${next}.statn_id as toStatn,
			coalesce(${next}.arrive_sec, ${next}.depart_sec) - coalesce(a.depart_sec, a.arrive_sec) as runSec
		from ${timetableTrip} t
		join ${timetableStopTime} a on a.trip_id = t.id
		join ${timetableStopTime} ${next} on ${next}.trip_id = t.id and ${next}.seq = a.seq + 1
		where t.batch_id = ${timetableBatchId}
			and t.line_key = ${lineKey}
			and t.service_day = 'weekday'
			and coalesce(${next}.arrive_sec, ${next}.depart_sec) is not null
			and coalesce(a.depart_sec, a.arrive_sec) is not null
	`);
	const byPair = new Map<string, Map<TrackDirection, number[]>>();
	for (const row of rows) {
		if (row.runSec <= 0) {
			continue;
		}
		const key = `${row.fromStatn}>${row.toStatn}`;
		const byDirection = byPair.get(key) ?? new Map<TrackDirection, number[]>();
		const list = byDirection.get(row.direction) ?? [];
		list.push(row.runSec);
		byDirection.set(row.direction, list);
		byPair.set(key, byDirection);
	}
	return byPair;
}

/** 배치가 하나라도 없으면 null. 시간표 배치가 없으면 `nextRunSec`는 모두 null이다. */
export async function findSubwayMap(
	db: Database,
	lineKey: LineKey
): Promise<SubwayMap | null> {
	const trackBatchId = await currentTrackBatch(db);
	if (trackBatchId === null) {
		return null;
	}
	const crosswalkBatchId = await currentBatchOf(db, "station_crosswalk");
	const timetableBatchId = await currentBatchOf(db, "timetable");
	const shapes = await db
		.select({
			branchKey: trackShape.branchKey,
			coords: trackShape.coords,
			direction: trackShape.direction,
			id: trackShape.id,
		})
		.from(trackShape)
		.where(
			and(eq(trackShape.batchId, trackBatchId), eq(trackShape.lineKey, lineKey))
		)
		.orderBy(asc(trackShape.id));
	const stationRows = await db
		.select({
			offsetM: trackStation.offsetM,
			seq: trackStation.seq,
			shapeId: trackStation.trackShapeId,
			statnId: trackStation.statnId,
		})
		.from(trackStation)
		.innerJoin(trackShape, eq(trackShape.id, trackStation.trackShapeId))
		.where(
			and(eq(trackShape.batchId, trackBatchId), eq(trackShape.lineKey, lineKey))
		)
		.orderBy(asc(trackStation.trackShapeId), asc(trackStation.seq));
	const crosswalk = new Map<
		string,
		{ lat: number; lng: number; name: string }
	>();
	if (crosswalkBatchId !== null) {
		const points = await db
			.select({
				lat: stationCrosswalk.lat,
				lng: stationCrosswalk.lng,
				name: stationCrosswalk.nameCanonical,
				statnId: stationCrosswalk.statnId,
			})
			.from(stationCrosswalk)
			.where(
				and(
					eq(stationCrosswalk.batchId, crosswalkBatchId),
					eq(stationCrosswalk.lineKey, lineKey)
				)
			);
		for (const { statnId, ...rest } of points) {
			crosswalk.set(statnId, rest);
		}
	}
	const runTimes =
		timetableBatchId === null
			? new Map<string, Map<TrackDirection, number[]>>()
			: await loadRunTimes(db, timetableBatchId, lineKey);
	const branches: SubwayMapBranch[] = shapes.map((shape) => {
		const rows = stationRows.filter((row) => row.shapeId === shape.id);
		return {
			branchKey: shape.branchKey,
			direction: shape.direction,
			shape: shape.coords,
			stations: rows.flatMap((row, index) => {
				const point = crosswalk.get(row.statnId);
				if (!point) {
					return [];
				}
				const following = rows[index + 1];
				const samples = following
					? runTimes
							.get(`${row.statnId}>${following.statnId}`)
							?.get(shape.direction)
					: undefined;
				return [
					{
						lat: point.lat,
						lng: point.lng,
						name: point.name,
						nextRunSec: samples && samples.length > 0 ? median(samples) : null,
						offsetM: row.offsetM,
						seq: row.seq,
						stop: subwayStation(row.statnId),
					},
				];
			}),
		};
	});
	return { batchId: trackBatchId, branches, line: subwayLine(lineKey) };
}

/** 지하철 지도 응답의 ETag를 이루는 배치 번호들. 선로 배치가 없으면 null. */
async function subwayMapEtag(db: Database): Promise<string | null> {
	const track = await currentTrackBatch(db);
	if (track === null) {
		return null;
	}
	const crosswalk = await currentBatchOf(db, "station_crosswalk");
	const timetable = await currentBatchOf(db, "timetable");
	return `"submap-${track}-${crosswalk ?? 0}-${timetable ?? 0}"`;
}

/** 현재 역 좌표 배치의 모든 노선 역. 배치가 없으면 null. */
export async function listSubwayStations(
	db: Database
): Promise<{ batchId: number; stations: SubwayStationPoint[] } | null> {
	const batchId = await currentBatchOf(db, "station_crosswalk");
	if (batchId === null) {
		return null;
	}
	const rows = await db
		.select({
			lat: stationCrosswalk.lat,
			lineKey: stationCrosswalk.lineKey,
			lng: stationCrosswalk.lng,
			name: stationCrosswalk.nameCanonical,
			statnId: stationCrosswalk.statnId,
		})
		.from(stationCrosswalk)
		.where(eq(stationCrosswalk.batchId, batchId))
		.orderBy(asc(stationCrosswalk.id));
	return {
		batchId,
		stations: rows.map(({ lineKey, statnId, ...rest }) => ({
			...rest,
			line: subwayLine(lineKey),
			stop: subwayStation(statnId),
		})),
	};
}

/** 지도용 참조 데이터 API(`/v1/ref/map`). 공개 GET이고 배치 ETag로 하루 캐시한다. */
export function createMapRefRoutes(db: Database): Hono {
	const routes = new Hono();
	// 지하철 노선 응답은 배치가 같으면 같다. 시간표 집계가 무거워 ETag별로 캐시한다.
	const subwayCache = new Map<string, SubwayMap>();

	routes.get("/bus/:busRouteId", async (c) => {
		let etag = "";
		const found = await findBusMap(db, c.req.param("busRouteId"), (batchId) => {
			etag = `"busmap-${BUS_MAP_FORMAT}-${batchId}"`;
			return ifNoneMatchMatches(c.req.header("if-none-match"), etag);
		});
		if (!found) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		const headers = {
			"Cache-Control": CACHE_CONTROL,
			ETag: `"busmap-${BUS_MAP_FORMAT}-${found.batchId}"`,
		};
		if (found.notModified) {
			return c.body(null, 304, headers);
		}
		if (!found.map) {
			return c.json({ error: "route not found" }, 404);
		}
		return c.json(found.map, 200, headers);
	});

	routes.get("/subway-stations", async (c) => {
		const batchId = await currentBatchOf(db, "station_crosswalk");
		if (batchId === null) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		const headers = {
			"Cache-Control": CACHE_CONTROL,
			ETag: `"substations-${batchId}"`,
		};
		if (ifNoneMatchMatches(c.req.header("if-none-match"), headers.ETag)) {
			return c.body(null, 304, headers);
		}
		const result = await listSubwayStations(db);
		if (!result) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		return c.json(result, 200, headers);
	});

	routes.get("/subway/:lineKey", async (c) => {
		const lineKey = findLineKey(stripSubwayPrefix(c.req.param("lineKey")));
		if (!lineKey) {
			return c.json({ error: "line not found" }, 404);
		}
		const etag = await subwayMapEtag(db);
		if (etag === null) {
			return c.json({ error: "reference unavailable" }, 503);
		}
		const headers = { "Cache-Control": CACHE_CONTROL, ETag: etag };
		if (ifNoneMatchMatches(c.req.header("if-none-match"), etag)) {
			return c.body(null, 304, headers);
		}
		const cacheKey = `${etag}:${lineKey}`;
		let map = subwayCache.get(cacheKey);
		if (!map) {
			const built = await findSubwayMap(db, lineKey);
			if (!built) {
				return c.json({ error: "reference unavailable" }, 503);
			}
			subwayCache.clear();
			subwayCache.set(cacheKey, built);
			map = built;
		}
		return c.json(map, 200, headers);
	});

	return routes;
}

import type { Database } from "@Betro/db";
import { and, asc, eq } from "@Betro/db/operators";
import {
	busRoute,
	busRouteStop,
	referenceBatch,
	stationCrosswalk,
} from "@Betro/db/schema/transit";
import { currentBusBatch, seoulRouteWhere } from "./bus";
import { busLine, busStop, subwayLine, subwayStation } from "./ids";

export interface SearchStation {
	key: string;
	lat: number;
	lng: number;
	members: { line: string; stop: string }[];
	name: string;
}

export interface SearchRoute {
	line: string;
	name: string;
	routeType: string;
	shortName: string;
}

export interface SearchStop {
	arsId: string | null;
	lat: number;
	lng: number;
	name: string;
	stop: string;
	towards: string | null;
}

export interface SearchIndex {
	routes: SearchRoute[];
	stations: SearchStation[];
	stops: SearchStop[];
}

/** 같은 이름의 역이 이 거리 안에 있으면 한 역(환승역)으로 묶는다. */
export const STATION_GROUP_RADIUS_M = 700;

const EARTH_RADIUS_M = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;
const HALF = 2;

interface StationRow {
	lat: number;
	line: string;
	lng: number;
	name: string;
	stop: string;
}

function distanceM(a: StationRow, b: StationRow): number {
	const dLat = (b.lat - a.lat) * DEGREES_TO_RADIANS;
	const dLng = (b.lng - a.lng) * DEGREES_TO_RADIANS;
	const h =
		Math.sin(dLat / HALF) ** HALF +
		Math.cos(a.lat * DEGREES_TO_RADIANS) *
			Math.cos(b.lat * DEGREES_TO_RADIANS) *
			Math.sin(dLng / HALF) ** HALF;
	return HALF * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function compareText(a: string, b: string): number {
	if (a < b) {
		return -1;
	}
	return a > b ? 1 : 0;
}

/**
 * 이름이 같고 서로 700m 안에 이어지는 역을 한 줄로 묶는다.
 * 입력 순서와 상관없이 같은 결과가 나오도록 역 ID로 먼저 정렬한다.
 * 결과는 이름, 키 순이다.
 */
export function groupStations(rows: readonly StationRow[]): SearchStation[] {
	const sorted = rows.slice().sort((a, b) => compareText(a.stop, b.stop));
	const byName = new Map<string, StationRow[]>();
	for (const row of sorted) {
		const list = byName.get(row.name);
		if (list) {
			list.push(row);
		} else {
			byName.set(row.name, [row]);
		}
	}
	const groups: SearchStation[] = [];
	for (const [name, list] of byName) {
		// 가까운 역끼리 이어 붙이는 union-find
		const parent = list.map((_, i) => i);
		const find = (i: number): number => {
			let root = i;
			while (parent[root] !== root) {
				root = parent[root] ?? root;
			}
			return root;
		};
		for (let i = 0; i < list.length; i += 1) {
			for (let j = i + 1; j < list.length; j += 1) {
				const a = list[i];
				const b = list[j];
				if (a && b && distanceM(a, b) <= STATION_GROUP_RADIUS_M) {
					parent[find(j)] = find(i);
				}
			}
		}
		const clusters = new Map<number, StationRow[]>();
		list.forEach((row, i) => {
			const root = find(i);
			const members = clusters.get(root);
			if (members) {
				members.push(row);
			} else {
				clusters.set(root, [row]);
			}
		});
		for (const members of clusters.values()) {
			groups.push({
				key: members.map((m) => m.stop).join(","),
				lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length,
				lng: members.reduce((sum, m) => sum + m.lng, 0) / members.length,
				members: members.map((m) => ({ line: m.line, stop: m.stop })),
				name,
			});
		}
	}
	return groups.sort(
		(a, b) => compareText(a.name, b.name) || compareText(a.key, b.key)
	);
}

async function currentCrosswalkBatch(db: Database): Promise<number | null> {
	const [row] = await db
		.select({ id: referenceBatch.id })
		.from(referenceBatch)
		.where(
			and(
				eq(referenceBatch.kind, "station_crosswalk"),
				eq(referenceBatch.isCurrent, true)
			)
		)
		.limit(1);
	return row?.id ?? null;
}

async function loadStations(
	db: Database,
	crosswalkBatchId: number
): Promise<SearchStation[]> {
	const rows = await db
		.select({
			lat: stationCrosswalk.lat,
			lineKey: stationCrosswalk.lineKey,
			lng: stationCrosswalk.lng,
			name: stationCrosswalk.nameCanonical,
			statnId: stationCrosswalk.statnId,
		})
		.from(stationCrosswalk)
		.where(eq(stationCrosswalk.batchId, crosswalkBatchId));
	return groupStations(
		rows.map((row) => ({
			lat: row.lat,
			line: subwayLine(row.lineKey),
			lng: row.lng,
			name: row.name,
			stop: subwayStation(row.statnId),
		}))
	);
}

async function loadRoutes(db: Database, busBatchId: number) {
	const rows = await db
		.select({
			name: busRoute.routeName,
			routeId: busRoute.routeId,
			routeType: busRoute.routeType,
			shortName: busRoute.shortName,
			source: busRoute.source,
		})
		.from(busRoute)
		.where(seoulRouteWhere(busBatchId))
		.orderBy(asc(busRoute.shortName), asc(busRoute.routeId));
	return rows.map(
		(row): SearchRoute => ({
			line: busLine(row.source, row.routeId),
			name: row.name,
			routeType: row.routeType,
			shortName: row.shortName,
		})
	);
}

/** 서울 노선이 지나는 정류장을 정류장 ID로 묶고, 가장 많은 노선이 가는 다음 정류장 이름을 방면으로 붙인다. */
async function loadStops(
	db: Database,
	busBatchId: number
): Promise<SearchStop[]> {
	const rows = await db
		.select({
			arsId: busRouteStop.arsId,
			busRouteId: busRouteStop.busRouteId,
			lat: busRouteStop.lat,
			lng: busRouteStop.lng,
			name: busRouteStop.name,
			seq: busRouteStop.seq,
			stationId: busRouteStop.stationId,
		})
		.from(busRouteStop)
		.innerJoin(busRoute, eq(busRoute.id, busRouteStop.busRouteId))
		.where(seoulRouteWhere(busBatchId))
		.orderBy(asc(busRouteStop.busRouteId), asc(busRouteStop.seq));
	const stops = new Map<
		string,
		{ base: Omit<SearchStop, "towards">; towards: Map<string, number> }
	>();
	rows.forEach((row, index) => {
		let entry = stops.get(row.stationId);
		if (!entry) {
			entry = {
				base: {
					arsId: row.arsId,
					lat: row.lat,
					lng: row.lng,
					name: row.name,
					stop: busStop("seoul", row.stationId),
				},
				towards: new Map(),
			};
			stops.set(row.stationId, entry);
		}
		const next = rows[index + 1];
		if (next && next.busRouteId === row.busRouteId) {
			entry.towards.set(next.name, (entry.towards.get(next.name) ?? 0) + 1);
		}
	});
	return [...stops.values()]
		.map(({ base, towards }): SearchStop => {
			const [best] = [...towards.entries()].sort(
				(a, b) => b[1] - a[1] || compareText(a[0], b[0])
			);
			return { ...base, towards: best ? best[0] : null };
		})
		.sort((a, b) => compareText(a.name, b.name) || compareText(a.stop, b.stop));
}

/** 앱이 기기에서 검색할 서울 역·노선·정류장 색인. 배치가 하나라도 없으면 null. */
export async function buildSearchIndex(
	db: Database
): Promise<{ etag: string; index: SearchIndex } | null> {
	const busBatchId = await currentBusBatch(db);
	const crosswalkBatchId = await currentCrosswalkBatch(db);
	if (busBatchId === null || crosswalkBatchId === null) {
		return null;
	}
	const [stations, routes, stops] = await Promise.all([
		loadStations(db, crosswalkBatchId),
		loadRoutes(db, busBatchId),
		loadStops(db, busBatchId),
	]);
	return {
		etag: `"search-${crosswalkBatchId}-${busBatchId}"`,
		index: { routes, stations, stops },
	};
}

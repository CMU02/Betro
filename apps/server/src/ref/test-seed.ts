import type { LibsqlDatabase } from "@Betro/db";
import {
	type BusRegion,
	type BusSource,
	busRoute,
	busRouteStop,
	referenceBatch,
} from "@Betro/db/schema/transit";

interface SeedRoute {
	areaName?: string;
	region: BusRegion;
	routeId: string;
	routeName: string;
	routeType: string;
	shortName: string;
	source?: BusSource;
}

/** 같은 번호(11)가 시·군마다 있는 GBIS 마을버스. 둘째는 서울 노선(서초03)과 routeId가 같다. */
export const GBIS_ROUTE_ID = "224000011";
export const GBIS_OTHER_ROUTE_ID = "228000011";
export const GBIS_COLLIDING_ROUTE_ID = "100100002";

const CURRENT_ROUTES: SeedRoute[] = [
	{
		region: "seoul",
		routeId: "100100001",
		routeName: "1000",
		routeType: "6",
		shortName: "1000",
	},
	{
		region: "gyeonggi",
		routeId: "200000001",
		routeName: "1000",
		routeType: "8",
		shortName: "1000",
	},
	{
		region: "gyeonggi",
		routeId: "234001243",
		routeName: "M5107광주",
		routeType: "8",
		shortName: "M5107",
	},
	{
		region: "seoul",
		routeId: "100100002",
		routeName: "서초03",
		routeType: "2",
		shortName: "서초03",
	},
	{
		region: "seoul",
		routeId: "100100003",
		routeName: "100",
		routeType: "3",
		shortName: "100",
	},
	{
		region: "seoul",
		routeId: "100100004",
		routeName: "110A",
		routeType: "3",
		shortName: "110A",
	},
	{
		areaName: "성남",
		region: "gyeonggi",
		routeId: GBIS_ROUTE_ID,
		routeName: "11",
		routeType: "30",
		shortName: "11",
		source: "gbis",
	},
	{
		areaName: "수원",
		region: "gyeonggi",
		routeId: GBIS_OTHER_ROUTE_ID,
		routeName: "11",
		routeType: "30",
		shortName: "11",
		source: "gbis",
	},
	{
		areaName: "안양",
		region: "gyeonggi",
		routeId: GBIS_COLLIDING_ROUTE_ID,
		routeName: "충돌",
		routeType: "30",
		shortName: "충돌",
		source: "gbis",
	},
];

const STOPS = [
	{ arsId: "01002", name: "둘째", seq: 2, stationId: "S2" },
	{ arsId: null, name: "첫째", seq: 1, stationId: "S1" },
	{ arsId: "01003", name: "셋째", seq: 3, stationId: "S3" },
];

const GBIS_STOPS = [
	{ arsId: null, name: "경기첫째", seq: 1, stationId: "S1" },
	{ arsId: null, name: "경기둘째", seq: 2, stationId: "G2" },
];

export const OLD_ONLY_ROUTE_ID = "999000001";

/** 옛 배치 하나(옛 노선 포함)와 현재 배치 하나(노선 8개)를 넣는다. */
export async function seedBusReference(
	db: LibsqlDatabase
): Promise<{ currentBatchId: number }> {
	const [old, current] = await db
		.insert(referenceBatch)
		.values([
			{ isCurrent: false, kind: "bus_route", sourceManifest: {} },
			{ isCurrent: true, kind: "bus_route", sourceManifest: {} },
		])
		.returning({ id: referenceBatch.id });
	if (!(old && current)) {
		throw new Error("seed batches missing");
	}
	await db.insert(busRoute).values({
		batchId: old.id,
		qualityFlags: [],
		region: "seoul",
		routeId: OLD_ONLY_ROUTE_ID,
		routeName: "옛노선",
		routeType: "3",
		shortName: "옛노선",
	});
	const inserted = await db
		.insert(busRoute)
		.values(
			CURRENT_ROUTES.map((route) => ({
				...route,
				batchId: current.id,
				qualityFlags: [],
			}))
		)
		.returning({
			id: busRoute.id,
			routeId: busRoute.routeId,
			source: busRoute.source,
		});
	const first = inserted.find(
		(row) => row.routeId === "100100001" && row.source === "seoul"
	);
	const gbis = inserted.find((row) => row.routeId === GBIS_ROUTE_ID);
	if (!(first && gbis)) {
		throw new Error("seed route missing");
	}
	await db.insert(busRouteStop).values(
		STOPS.map((stop) => ({
			...stop,
			apiSectDistM: 0,
			busRouteId: first.id,
			directionName: stop.seq === 1 ? "종점행" : null,
			distanceM: 0,
			lat: 37.5,
			lng: 127,
			offsetM: 0,
			qualityFlags: [],
		}))
	);
	await db.insert(busRouteStop).values(
		GBIS_STOPS.map((stop) => ({
			...stop,
			apiSectDistM: 0,
			busRouteId: gbis.id,
			directionName: null,
			distanceM: 0,
			lat: 37.4,
			lng: 127.1,
			offsetM: 0,
			qualityFlags: [],
		}))
	);
	return { currentBatchId: current.id };
}

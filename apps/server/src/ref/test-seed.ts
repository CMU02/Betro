import type { LibsqlDatabase } from "@Betro/db";
import {
	type BusRegion,
	busRoute,
	busRouteStop,
	referenceBatch,
} from "@Betro/db/schema/transit";

interface SeedRoute {
	region: BusRegion;
	routeId: string;
	routeName: string;
	routeType: string;
	shortName: string;
}

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
];

const STOPS = [
	{ arsId: "01002", name: "둘째", seq: 2, stationId: "S2" },
	{ arsId: null, name: "첫째", seq: 1, stationId: "S1" },
	{ arsId: "01003", name: "셋째", seq: 3, stationId: "S3" },
];

export const OLD_ONLY_ROUTE_ID = "999000001";

/** 옛 배치 하나(옛 노선 포함)와 현재 배치 하나(노선 5개)를 넣는다. */
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
		.returning({ id: busRoute.id, routeId: busRoute.routeId });
	const first = inserted.find((row) => row.routeId === "100100001");
	if (!first) {
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
	return { currentBatchId: current.id };
}

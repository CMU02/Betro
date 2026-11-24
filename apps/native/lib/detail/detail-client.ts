import { z } from "zod";
import { read } from "@/lib/map/map-client";
import type { RefResult } from "@/lib/ref/ref-client";
import type { ServerClient } from "@/lib/server/api-client";

/** 서버 `apps/server/src/map/station-view.ts`의 같은 이름 값과 같다. */
export const STATION_VIEW_MAX = 6;

const approachingSchema = z.object({
	etaAt: z.number().nullable(),
	method: z.string().nullable(),
	stopsAway: z.number().nullable(),
	vehicleId: z.string(),
});

const stationViewDirectionSchema = z.object({
	approaching: z.array(approachingSchema),
	direction: z.enum(["up", "down"]),
	etaState: z.enum(["live", "estimated"]),
	firstAt: z.number().nullable(),
	headwayMs: z.number().nullable(),
	lastAt: z.number().nullable(),
});

const stationViewSchema = z.object({
	generatedAt: z.number(),
	stations: z.array(
		z.object({
			directions: z.array(stationViewDirectionSchema),
			line: z.string(),
			stop: z.string(),
		})
	),
	timezone: z.string(),
});

const busRouteViewSchema = z.object({
	etaState: z.enum(["live", "estimated"]),
	fetchedAt: z.number().nullable(),
	headwayMs: z.number().nullable(),
	route: z.object({
		name: z.string(),
		routeType: z.string(),
		shortName: z.string(),
	}),
	stops: z.array(
		z.object({
			seq: z.number(),
			vehicles: z.array(
				z.object({
					etaAt: z.number().nullable(),
					plate: z.string().nullable(),
					stopsAway: z.number().nullable(),
					vehicleId: z.string(),
				})
			),
		})
	),
});

const stopRoutesSchema = z.object({
	arsId: z.string().nullable(),
	lat: z.number(),
	lng: z.number(),
	name: z.string(),
	routes: z.array(
		z.object({
			directionName: z.string().nullable(),
			firstBusMinute: z.number().nullable(),
			headwayMin: z.number().nullable(),
			lastBusMinute: z.number().nullable(),
			line: z.string(),
			nextStopName: z.string().nullable(),
			routeType: z.string(),
			seq: z.number(),
			shortName: z.string(),
		})
	),
	stop: z.string(),
	timezone: z.string(),
});

const tripStopsSchema = z.object({
	direction: z.enum(["up", "down"]),
	express: z.boolean(),
	line: z.string(),
	stops: z.array(
		z.object({
			arriveAt: z.number().nullable(),
			departAt: z.number().nullable(),
			name: z.string(),
			stop: z.string(),
		})
	),
	timezone: z.string(),
	tripId: z.number(),
});

export type StationView = z.infer<typeof stationViewSchema>;
export type StationViewDirection = z.infer<typeof stationViewDirectionSchema>;
export type BusRouteViewResponse = z.infer<typeof busRouteViewSchema>;
export type StopRoutes = z.infer<typeof stopRoutesSchema>;
export type TripStops = z.infer<typeof tripStopsSchema>;

/** 역 도착판. 역은 `STATION_VIEW_MAX`개까지다. 401·503은 unavailable이다. */
export async function fetchStationView(
	client: ServerClient,
	stations: { line: string; stop: string }[]
): Promise<RefResult<StationView>> {
	const response = await client.request("POST", "/v1/map/station-view", {
		stations,
	});
	return read(response, stationViewSchema);
}

/** 서울 버스 노선의 정류장별 도착. */
export async function fetchBusRouteView(
	client: ServerClient,
	line: string
): Promise<RefResult<BusRouteViewResponse>> {
	const response = await client.request("POST", "/v1/map/bus-route-view", {
		line,
	});
	return read(response, busRouteViewSchema);
}

/** 서울 정류장을 지나는 노선. */
export async function fetchStopRoutes(
	client: ServerClient,
	stop: string
): Promise<RefResult<StopRoutes>> {
	const response = await client.request(
		"GET",
		`/v1/ref/bus/stops/${encodeURIComponent(stop)}/routes`
	);
	return read(response, stopRoutesSchema);
}

/** 열차 한 편의 정차 목록. */
export async function fetchTrip(
	client: ServerClient,
	tripId: number
): Promise<RefResult<TripStops>> {
	const response = await client.request(
		"GET",
		`/v1/ref/subway/trips/${tripId}`
	);
	return read(response, tripStopsSchema);
}

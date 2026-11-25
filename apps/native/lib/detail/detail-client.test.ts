import { describe, expect, it } from "bun:test";
import type { ServerClient, ServerResponse } from "@/lib/server/api-client";
import {
	fetchBusRouteView,
	fetchStationView,
	fetchStopRoutes,
	fetchTrip,
	STATION_VIEW_MAX,
} from "./detail-client";

function clientOf(response: Partial<ServerResponse>) {
	const calls: { body: unknown; method: string; path: string }[] = [];
	const client: ServerClient = {
		request: (method, path, body) => {
			calls.push({ body, method, path });
			return Promise.resolve({
				etag: null,
				json: null,
				status: 200,
				...response,
			} as ServerResponse);
		},
	};
	return { calls, client };
}

describe("detail-client", () => {
	it("station-view 401은 unavailable이다", async () => {
		const { client } = clientOf({ status: 401 });
		expect(await fetchStationView(client, [{ line: "a", stop: "b" }])).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});

	it("station-view는 본문을 읽고 요청 모양을 지킨다", async () => {
		const { calls, client } = clientOf({
			json: {
				generatedAt: 1,
				stations: [
					{
						directions: [
							{
								approaching: [
									{
										etaAt: 5,
										method: "timetable",
										stopsAway: null,
										vehicleId: "timetable:1",
									},
								],
								direction: "up",
								etaState: "estimated",
								firstAt: null,
								headwayMs: 240_000,
								lastAt: null,
							},
						],
						line: "seoul-subway:line2",
						stop: "seoul-subway:1002000222",
					},
				],
				timezone: "Asia/Seoul",
			},
		});
		const result = await fetchStationView(client, [
			{ line: "seoul-subway:line2", stop: "seoul-subway:1002000222" },
		]);
		expect(result.ok).toBe(true);
		expect(calls[0]).toMatchObject({
			method: "POST",
			path: "/v1/map/station-view",
		});
		expect(STATION_VIEW_MAX).toBe(6);
	});

	it("버스 노선 보기·정류장 노선·열차 운행을 읽는다", async () => {
		const bus = await fetchBusRouteView(
			clientOf({
				json: {
					etaState: "estimated",
					fetchedAt: null,
					headwayMs: 480_000,
					route: { name: "146", routeType: "3", shortName: "146" },
					stops: [],
				},
			}).client,
			"seoul-bus:100100118"
		);
		expect(bus.ok).toBe(true);
		const stop = clientOf({
			json: {
				arsId: null,
				lat: 1,
				lng: 2,
				name: "정류장",
				routes: [
					{
						directionName: null,
						firstBusMinute: null,
						headwayMin: null,
						lastBusMinute: null,
						line: "seoul-bus:1",
						nextStopName: null,
						routeType: "3",
						seq: 1,
						shortName: "146",
					},
				],
				stop: "seoul-bus:111",
				timezone: "Asia/Seoul",
			},
		});
		expect((await fetchStopRoutes(stop.client, "seoul-bus:111")).ok).toBe(true);
		expect(stop.calls[0]?.path).toBe(
			"/v1/ref/bus/stops/seoul-bus%3A111/routes"
		);
		const trip = clientOf({
			json: {
				direction: "up",
				express: false,
				line: "seoul-subway:line2",
				stops: [
					{ arriveAt: null, departAt: 1, name: "강남", stop: "seoul-subway:1" },
				],
				timezone: "Asia/Seoul",
				tripId: 7,
			},
		});
		expect((await fetchTrip(trip.client, 7)).ok).toBe(true);
		expect(trip.calls[0]?.path).toBe("/v1/ref/subway/trips/7");
		expect(await fetchTrip(clientOf({ status: 404 }).client, 7)).toEqual({
			ok: false,
			reason: "not-found",
		});
	});
});

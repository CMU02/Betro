import type { Route } from "@Betro/commute/plan";
import { describe, expect, it } from "bun:test";
import type {
	ServerClient,
	ServerRequestOptions,
	ServerResponse,
} from "@/lib/server/api-client";
import {
	createMapRefCache,
	fetchBusMap,
	fetchSnapshot,
	fetchSubwayMap,
	fetchSubwayStations,
	postRouteView,
	postWatch,
} from "./map-client";

interface Call {
	body: unknown;
	method: string;
	options: ServerRequestOptions | undefined;
	path: string;
}

function fakeClient(response: ServerResponse): {
	calls: Call[];
	client: ServerClient;
} {
	const calls: Call[] = [];
	return {
		calls,
		client: {
			request: (method, path, body, options) => {
				calls.push({ body, method, options, path });
				return Promise.resolve(response);
			},
		},
	};
}

const BUS_MAP = {
	batchId: 3,
	line: "seoul-bus:100100124",
	shape: [
		[127, 37.5],
		[127.01, 37.51],
	],
	stops: [
		{
			arsId: "01234",
			lat: 37.5,
			lng: 127,
			name: "정류장",
			seq: 1,
			stop: "seoul-bus:111",
		},
	],
};

const SUBWAY_MAP = {
	batchId: 4,
	branches: [
		{
			branchKey: "main",
			direction: "up",
			shape: [[127, 37.5]],
			stations: [
				{
					lat: 37.5,
					lng: 127,
					name: "강남",
					nextRunSec: 120,
					offsetM: 0,
					seq: 1,
					stop: "seoul-subway:1002000222",
				},
			],
		},
	],
	line: "seoul-subway:2",
};

describe("map ref fetchers", () => {
	it("fetchBusMap reads the shape and stops and reads a missing direction as null", async () => {
		const { client, calls } = fakeClient({ json: BUS_MAP, status: 200 });
		const result = await fetchBusMap(client, "seoul-bus:100100124", null);
		expect(result).toEqual({
			ok: true,
			value: {
				etag: null,
				value: {
					...BUS_MAP,
					stops: BUS_MAP.stops.map((stop) => ({
						...stop,
						directionName: null,
					})),
				},
			},
		});
		expect(calls[0]?.path).toBe("/v1/ref/map/bus/seoul-bus%3A100100124");
	});

	it("fetchSubwayMap reads branches", async () => {
		const { client, calls } = fakeClient({
			etag: '"submap-1-2-3"',
			json: SUBWAY_MAP,
			status: 200,
		});
		const result = await fetchSubwayMap(client, "seoul-subway:2", null);
		expect(result).toEqual({
			ok: true,
			value: { etag: '"submap-1-2-3"', value: SUBWAY_MAP },
		});
		expect(calls[0]?.path).toBe("/v1/ref/map/subway/seoul-subway%3A2");
	});

	it("sends If-None-Match for ref maps and maps 304 to not-modified", async () => {
		const bus = fakeClient({ json: null, status: 304 });
		expect(await fetchBusMap(bus.client, "1", '"busmap-3"')).toEqual({
			ok: true,
			value: "not-modified",
		});
		expect(bus.calls[0]?.options?.headers).toEqual({
			"If-None-Match": '"busmap-3"',
		});
		const subway = fakeClient({ json: null, status: 304 });
		expect(await fetchSubwayMap(subway.client, "2", '"submap-1"')).toEqual({
			ok: true,
			value: "not-modified",
		});
		expect(subway.calls[0]?.options?.headers).toEqual({
			"If-None-Match": '"submap-1"',
		});
	});

	it("fetchSubwayStations unwraps the stations list", async () => {
		const station = {
			lat: 37.5,
			line: "seoul-subway:2",
			lng: 127,
			name: "강남",
			stop: "seoul-subway:1002000222",
		};
		const { client } = fakeClient({
			json: { batchId: 1, stations: [station] },
			status: 200,
		});
		expect(await fetchSubwayStations(client)).toEqual({
			ok: true,
			value: [station],
		});
	});

	it("maps failures to reasons and rejects a bad body", async () => {
		expect(
			await fetchBusMap(fakeClient({ json: null, status: 0 }).client, "1", null)
		).toEqual({ ok: false, reason: "offline" });
		expect(
			await fetchBusMap(
				fakeClient({ json: null, status: 503 }).client,
				"1",
				null
			)
		).toEqual({ ok: false, reason: "unavailable" });
		expect(
			await fetchBusMap(
				fakeClient({ json: null, status: 404 }).client,
				"1",
				null
			)
		).toEqual({ ok: false, reason: "not-found" });
		expect(
			await fetchBusMap(
				fakeClient({ json: { x: 1 }, status: 200 }).client,
				"1",
				null
			)
		).toEqual({ ok: false, reason: "invalid" });
	});
});

const BUS_VEHICLE = {
	lastSeenAt: 1000,
	lat: 37.5,
	lng: 127,
	observedAt: 990,
	routeId: "100100124",
	sectOrd: 4,
	vehId: "v1",
};

describe("fetchSnapshot", () => {
	it("sends If-None-Match and maps 304 to not-modified", async () => {
		const { client, calls } = fakeClient({ json: null, status: 304 });
		const result = await fetchSnapshot(client, "bus", '"abc"');
		expect(result).toEqual({ ok: true, value: "not-modified" });
		expect(calls[0]?.path).toBe("/v1/snapshot/bus");
		expect(calls[0]?.options?.headers).toEqual({ "If-None-Match": '"abc"' });
	});

	it("sends no header without an etag and parses only the map fields of bus vehicles", async () => {
		const { client, calls } = fakeClient({
			etag: '"def"',
			json: {
				generatedAt: 1,
				staleRoutes: {},
				staleSince: null,
				vehicles: [{ ...BUS_VEHICLE, plainNo: "ignored" }],
			},
			status: 200,
		});
		const result = await fetchSnapshot(client, "bus", null);
		expect(calls[0]?.options?.headers).toBeUndefined();
		expect(result.ok).toBe(true);
		if (result.ok && result.value !== "not-modified") {
			expect(result.value.etag).toBe('"def"');
			expect(result.value.snapshot.vehicles).toEqual([BUS_VEHICLE]);
		}
	});

	it("parses subway trains and keeps unknown positions nullable", async () => {
		const train = {
			direction: "up",
			lastSeenAt: 5,
			lineKey: "2",
			observedAt: 4,
			rawTrainNo: "2101",
			stationDistanceM: null,
			statnId: null,
			status: null,
		};
		const { client } = fakeClient({
			etag: '"s"',
			json: { generatedAt: 1, staleSince: null, vehicles: [train] },
			status: 200,
		});
		const result = await fetchSnapshot(client, "subway", null);
		expect(result.ok).toBe(true);
		if (result.ok && result.value !== "not-modified") {
			expect(result.value.snapshot.vehicles).toEqual([train]);
		}
	});

	it("treats a 200 without an etag as invalid", async () => {
		const { client } = fakeClient({
			json: { generatedAt: 1, staleSince: null, vehicles: [] },
			status: 200,
		});
		expect(await fetchSnapshot(client, "subway", null)).toEqual({
			ok: false,
			reason: "invalid",
		});
	});
});

describe("postWatch", () => {
	it("posts { busRoutes } and returns null on 204", async () => {
		const { client, calls } = fakeClient({ json: null, status: 204 });
		expect(await postWatch(client, ["seoul-bus:1"])).toEqual({
			ok: true,
			value: null,
		});
		expect(calls[0]).toMatchObject({
			body: { busRoutes: ["seoul-bus:1"] },
			method: "POST",
			path: "/v1/map/watch",
		});
	});

	it("maps 400 too-many-routes to invalid", async () => {
		const { client } = fakeClient({
			json: { error: "too-many-routes" },
			status: 400,
		});
		expect(await postWatch(client, ["seoul-bus:1"])).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("maps 401 to unavailable", async () => {
		const { client } = fakeClient({ json: null, status: 401 });
		expect(await postWatch(client, [])).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});
});

describe("postRouteView", () => {
	const route = { legs: [], rank: 0 } as unknown as Route;

	it("postRouteView maps 401 to unavailable", async () => {
		const { client } = fakeClient({ json: null, status: 401 });
		expect(await postRouteView(client, route)).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});

	it("postRouteView posts { route } and parses legs", async () => {
		const view = {
			destinationEtaAt: 1000,
			legs: [
				{
					approaching: [
						{ etaAt: 900, method: "official", stopsAway: 2, vehicleId: "v1" },
					],
					boardEtaAt: 800,
					etaState: "live",
					method: "official",
					positionState: "live",
					vehicleId: "v1",
				},
			],
		};
		const { client, calls } = fakeClient({ json: view, status: 200 });
		expect(await postRouteView(client, route)).toEqual({
			ok: true,
			value: view,
		});
		expect(calls[0]).toMatchObject({
			body: { route },
			method: "POST",
			path: "/v1/map/route-view",
		});
	});

	it("rejects a malformed view", async () => {
		const { client } = fakeClient({ json: { legs: "x" }, status: 200 });
		expect(await postRouteView(client, route)).toEqual({
			ok: false,
			reason: "invalid",
		});
	});
});

describe("createMapRefCache", () => {
	function memoryStore() {
		const data = new Map<string, string>();
		return {
			getItem: (key: string) => Promise.resolve(data.get(key) ?? null),
			setItem: (key: string, value: string) => {
				data.set(key, value);
				return Promise.resolve();
			},
		};
	}

	it("round-trips a value with its etag", async () => {
		const cache = createMapRefCache(memoryStore());
		expect(await cache.get("k")).toBeNull();
		await cache.set("k", '"e1"', { a: 1 });
		expect(await cache.get("k")).toEqual({ etag: '"e1"', value: { a: 1 } });
	});

	it("reads corrupt storage as a miss", async () => {
		const store = memoryStore();
		await store.setItem("betro.mapRef.k", "{not json");
		expect(await createMapRefCache(store).get("k")).toBeNull();
	});
});

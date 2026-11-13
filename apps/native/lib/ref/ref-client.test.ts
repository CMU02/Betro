import { describe, expect, it } from "bun:test";
import type { ServerClient, ServerResponse } from "@/lib/server/api-client";
import {
	busRouteStops,
	REF_STALE_MS,
	refStaleTime,
	searchBusRoutes,
	subwayDirection,
	subwayLines,
	subwayStations,
} from "./ref-client";

function fakeClient(response: ServerResponse): {
	calls: { method: string; path: string }[];
	client: ServerClient;
} {
	const calls: { method: string; path: string }[] = [];
	return {
		calls,
		client: {
			request: (method, path) => {
				calls.push({ method, path });
				return Promise.resolve(response);
			},
		},
	};
}

const ROUTE = {
	line: "100100124",
	name: "341",
	region: "seoul",
	routeType: "3",
	shortName: "341",
};
const STOP = {
	arsId: "01234",
	directionName: "강남",
	name: "정류장",
	seq: 1,
	stop: "S1",
};

describe("searchBusRoutes", () => {
	it("reads the matching routes", async () => {
		const { client, calls } = fakeClient({
			json: { batchId: "b1", routes: [ROUTE] },
			status: 200,
		});
		expect(await searchBusRoutes(client, " 341 ")).toEqual({
			ok: true,
			value: [ROUTE],
		});
		expect(calls[0]?.method).toBe("GET");
		expect(calls[0]?.path).toBe("/v1/ref/bus/routes?q=341");
	});

	it("does not call the server for a blank query", async () => {
		const { client, calls } = fakeClient({ json: null, status: 200 });
		expect(await searchBusRoutes(client, "   ")).toEqual({
			ok: true,
			value: [],
		});
		expect(calls).toHaveLength(0);
	});

	it("encodes the query", async () => {
		const { client, calls } = fakeClient({
			json: { batchId: "b1", routes: [] },
			status: 200,
		});
		await searchBusRoutes(client, "a&b");
		expect(calls[0]?.path).toBe("/v1/ref/bus/routes?q=a%26b");
	});

	it.each([
		[0, "offline"],
		[503, "unavailable"],
		[404, "not-found"],
		[500, "invalid"],
	] as const)("maps status %d to %s", async (status, reason) => {
		const { client } = fakeClient({ json: null, status });
		expect(await searchBusRoutes(client, "341")).toEqual({
			ok: false,
			reason,
		});
	});

	it("rejects a body with a missing field", async () => {
		const { shortName: _omit, ...partial } = ROUTE;
		const { client } = fakeClient({
			json: { batchId: "b1", routes: [partial] },
			status: 200,
		});
		expect(await searchBusRoutes(client, "341")).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("rejects an unknown region", async () => {
		const { client } = fakeClient({
			json: { batchId: "b1", routes: [{ ...ROUTE, region: "busan" }] },
			status: 200,
		});
		expect(await searchBusRoutes(client, "341")).toEqual({
			ok: false,
			reason: "invalid",
		});
	});
});

describe("busRouteStops", () => {
	const body = {
		line: "100100124",
		name: "341",
		region: "seoul",
		shortName: "341",
		stops: [STOP, { ...STOP, arsId: null, directionName: null, seq: 2 }],
	};

	it("reads the stops and encodes the line", async () => {
		const { client, calls } = fakeClient({ json: body, status: 200 });
		const result = await busRouteStops(client, "GGB:233");
		expect(result).toEqual({ ok: true, value: body });
		expect(calls[0]?.path).toBe("/v1/ref/bus/routes/GGB%3A233/stops");
	});

	it("maps 404 and a broken body", async () => {
		expect(
			await busRouteStops(fakeClient({ json: null, status: 404 }).client, "x")
		).toEqual({ ok: false, reason: "not-found" });
		expect(
			await busRouteStops(
				fakeClient({ json: { ...body, stops: [{ seq: 1 }] }, status: 200 })
					.client,
				"x"
			)
		).toEqual({ ok: false, reason: "invalid" });
	});
});

describe("subwayLines", () => {
	it("reads the lines", async () => {
		const lines = [{ line: "1002", name: "2호선" }];
		const { client, calls } = fakeClient({ json: { lines }, status: 200 });
		expect(await subwayLines(client)).toEqual({ ok: true, value: lines });
		expect(calls[0]?.path).toBe("/v1/ref/subway/lines");
	});

	it("maps 503 and a broken body", async () => {
		expect(
			await subwayLines(fakeClient({ json: null, status: 503 }).client)
		).toEqual({ ok: false, reason: "unavailable" });
		expect(
			await subwayLines(
				fakeClient({ json: { lines: [{}] }, status: 200 }).client
			)
		).toEqual({ ok: false, reason: "invalid" });
	});
});

describe("subwayStations", () => {
	it("reads the branches and encodes the line", async () => {
		const branches = [
			{ branchKey: "main", stations: [{ name: "강남", stop: "1002000222" }] },
		];
		const { client, calls } = fakeClient({
			json: { batchId: "b1", branches },
			status: 200,
		});
		expect(await subwayStations(client, "10/02")).toEqual({
			ok: true,
			value: branches,
		});
		expect(calls[0]?.path).toBe("/v1/ref/subway/lines/10%2F02/stations");
	});

	it("maps 0 to offline", async () => {
		expect(
			await subwayStations(fakeClient({ json: null, status: 0 }).client, "1")
		).toEqual({ ok: false, reason: "offline" });
	});
});

describe("subwayDirection", () => {
	it("reads the direction and encodes the query", async () => {
		const { client, calls } = fakeClient({
			json: { direction: "down", stops: 2 },
			status: 200,
		});
		expect(await subwayDirection(client, "1002", "A&1", "B 2")).toEqual({
			ok: true,
			value: { direction: "down", stops: 2 },
		});
		expect(calls[0]?.path).toBe(
			"/v1/ref/subway/direction?line=1002&from=A%261&to=B%202"
		);
	});

	it("reports not-direct on 404 with that error", async () => {
		const { client } = fakeClient({
			json: { error: "not-direct" },
			status: 404,
		});
		expect(await subwayDirection(client, "1002", "A", "B")).toEqual({
			ok: false,
			reason: "not-direct",
		});
	});

	it("reports not-found on a plain 404", async () => {
		const { client } = fakeClient({ json: { error: "other" }, status: 404 });
		expect(await subwayDirection(client, "1002", "A", "B")).toEqual({
			ok: false,
			reason: "not-found",
		});
	});

	it.each([
		[0, "offline"],
		[503, "unavailable"],
		[400, "invalid"],
	] as const)("maps status %d to %s", async (status, reason) => {
		const { client } = fakeClient({ json: null, status });
		expect(await subwayDirection(client, "1002", "A", "B")).toEqual({
			ok: false,
			reason,
		});
	});

	it("rejects an unknown direction", async () => {
		const { client } = fakeClient({
			json: { direction: "left", stops: 2 },
			status: 200,
		});
		expect(await subwayDirection(client, "1002", "A", "B")).toEqual({
			ok: false,
			reason: "invalid",
		});
	});
});

describe("refStaleTime", () => {
	it("keeps a successful lookup fresh for ten minutes", () => {
		expect(REF_STALE_MS).toBe(600_000);
		expect(refStaleTime({ state: { data: { ok: true } } })).toBe(REF_STALE_MS);
	});

	it.each(["offline", "unavailable", "not-found", "invalid", "not-direct"])(
		"treats a %s failure as stale right away",
		(reason) => {
			const data = { ok: false, reason };
			expect(refStaleTime({ state: { data } })).toBe(0);
		}
	);

	it("treats a query with no data yet as stale", () => {
		expect(refStaleTime({ state: { data: undefined } })).toBe(0);
	});
});

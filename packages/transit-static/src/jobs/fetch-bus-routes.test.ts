import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPath } from "../paths";
import type { BusRouteListEntry } from "../sources/bus-route-xlsx";
import type { BusRouteOperation } from "../sources/seoul-bus-api";
import {
	BUS_PATH_SOURCE,
	BUS_STATIONS_SOURCE,
	fetchBusRoutes,
	ROUTE_NOT_FOUND_BODY,
} from "./fetch-bus-routes";

const KEY = "a/b+c==";
const ENCODED_KEY = encodeURIComponent(KEY);
const DAY_MS = 86_400_000;

interface Call {
	busRouteId: string;
	operation: BusRouteOperation;
}

type Responder = (call: Call, index: number) => Response;

function okBody(items: Record<string, string>[]): string {
	return JSON.stringify({
		msgBody: { itemList: items },
		msgHeader: { headerCd: "0", headerMsg: "ok", itemCount: items.length },
	});
}

function stationsBody(routeId: string, routeType: string): string {
	return okBody([
		{
			arsId: "1",
			busRouteId: routeId,
			busRouteNm: `R${routeId}`,
			direction: "B",
			fullSectDist: "0",
			gpsX: "127.0",
			gpsY: "37.5",
			routeType,
			seq: "1",
			station: `${routeId}01`,
			stationNm: "A",
		},
	]);
}

function pathBody(routeId: string): string {
	return okBody([
		{ gpsX: "127.0", gpsY: "37.5", no: "1", routeId },
		{ gpsX: "127.1", gpsY: "37.6", no: "2", routeId },
	]);
}

function headerBody(code: string): string {
	return JSON.stringify({
		msgBody: { itemList: null },
		msgHeader: { headerCd: code, headerMsg: `code ${code}`, itemCount: 0 },
	});
}

function fakeFetch(responder: Responder) {
	const calls: Call[] = [];
	const fetchImpl = ((input: string | URL | Request) => {
		const url = new URL(String(input));
		const operation = url.pathname.split("/").at(-1) as BusRouteOperation;
		const call = {
			busRouteId: url.searchParams.get("busRouteId") ?? "",
			operation,
		};
		calls.push(call);
		return Promise.resolve(responder(call, calls.length - 1));
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}

/** 정상 응답: routeTypes에 적힌 유형으로 정류소, 노선 모양은 항상 같은 모양. */
function normalResponder(
	routeTypes: Record<string, string>
): (call: Call) => Response {
	return (call) =>
		new Response(
			call.operation === "getStaionByRoute"
				? stationsBody(call.busRouteId, routeTypes[call.busRouteId] ?? "4")
				: pathBody(call.busRouteId),
			{ status: 200 }
		);
}

function route(routeId: string): BusRouteListEntry {
	return { routeId, routeName: `R${routeId}`, stopCount: 1 };
}

function stationsFile(dataDir: string, routeId: string): string {
	return rawPath(dataDir, BUS_STATIONS_SOURCE, `${routeId}.json`);
}

function pathFile(dataDir: string, routeId: string): string {
	return rawPath(dataDir, BUS_PATH_SOURCE, `${routeId}.json`);
}

const NO_RETRY_WAIT = [0, 0, 0] as const;

describe("fetchBusRoutes", () => {
	let dataDir: string;
	let logged: string[];
	const spies: ReturnType<typeof spyOn>[] = [];

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "betro-bus-routes-"));
		logged = [];
		for (const method of ["log", "warn", "error", "info"] as const) {
			spies.push(
				spyOn(console, method).mockImplementation((...args: unknown[]) => {
					logged.push(args.map(String).join(" "));
				})
			);
		}
	});

	afterEach(async () => {
		for (const spy of spies.splice(0)) {
			spy.mockRestore();
		}
		await rm(dataDir, { force: true, recursive: true });
	});

	it("fetches stations then path for in-scope routes and saves raw bodies", async () => {
		const { calls, fetchImpl } = fakeFetch(
			normalResponder({ "100100001": "4", "100100002": "2" })
		);
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			routes: [route("100100002"), route("100100001")],
		});

		expect(calls).toEqual([
			{ busRouteId: "100100001", operation: "getStaionByRoute" },
			{ busRouteId: "100100001", operation: "getRoutePath" },
			{ busRouteId: "100100002", operation: "getStaionByRoute" },
		]);
		expect(result).toEqual({
			failed: [],
			fetched: { getRoutePath: 1, getStaionByRoute: 2 },
			notFound: [],
			outOfScope: 1,
			routes: 2,
			skippedFresh: { getRoutePath: 0, getStaionByRoute: 0 },
			stoppedBy: null,
		});
		expect(await readFile(stationsFile(dataDir, "100100001"), "utf8")).toBe(
			stationsBody("100100001", "4")
		);
		expect(await readFile(stationsFile(dataDir, "100100002"), "utf8")).toBe(
			stationsBody("100100002", "2")
		);
		expect(await readFile(pathFile(dataDir, "100100001"), "utf8")).toBe(
			pathBody("100100001")
		);
		expect(existsSync(pathFile(dataDir, "100100002"))).toBe(false);
	});

	it("skips fresh files and resumes after quota stop", async () => {
		const routes = [route("100100001"), route("100100002")];
		let stationCalls = 0;
		const first = fakeFetch((call) => {
			if (call.operation === "getStaionByRoute") {
				stationCalls += 1;
				if (stationCalls === 2) {
					return new Response(
						"<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
						{ status: 200 }
					);
				}
			}
			return normalResponder({})(call);
		});
		const run1 = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: first.fetchImpl,
			key: KEY,
			routes,
		});
		expect(run1.stoppedBy).toBe("quota-exceeded");
		expect(run1.fetched).toEqual({ getRoutePath: 1, getStaionByRoute: 1 });
		expect(existsSync(stationsFile(dataDir, "100100001"))).toBe(true);
		expect(existsSync(pathFile(dataDir, "100100001"))).toBe(true);
		expect(existsSync(stationsFile(dataDir, "100100002"))).toBe(false);
		expect(existsSync(pathFile(dataDir, "100100002"))).toBe(false);

		const second = fakeFetch(normalResponder({}));
		const run2 = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: second.fetchImpl,
			key: KEY,
			routes,
		});
		expect(second.calls).toEqual([
			{ busRouteId: "100100002", operation: "getStaionByRoute" },
			{ busRouteId: "100100002", operation: "getRoutePath" },
		]);
		expect(run2.skippedFresh).toEqual({ getRoutePath: 1, getStaionByRoute: 1 });
		expect(run2.stoppedBy).toBeNull();
	});

	it("refetches files older than maxAgeDays", async () => {
		const routes = [route("100100001")];
		await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: fakeFetch(normalResponder({})).fetchImpl,
			key: KEY,
			routes,
		});
		const now = Date.now();
		const old = new Date(now - 8 * DAY_MS);
		await utimes(stationsFile(dataDir, "100100001"), old, old);

		const again = fakeFetch(normalResponder({}));
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: again.fetchImpl,
			key: KEY,
			maxAgeDays: 7,
			now: () => new Date(now),
			routes,
		});
		expect(again.calls).toEqual([
			{ busRouteId: "100100001", operation: "getStaionByRoute" },
		]);
		expect(result.skippedFresh).toEqual({
			getRoutePath: 1,
			getStaionByRoute: 0,
		});
	});

	it("retries retryable responses then records failure", async () => {
		const { calls, fetchImpl } = fakeFetch(
			() => new Response(headerBody("6"), { status: 200 })
		);
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			retryDelaysMs: NO_RETRY_WAIT,
			routes: [route("100100001")],
		});
		expect(calls).toHaveLength(4);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]).toMatchObject({
			kind: "retryable",
			operation: "getStaionByRoute",
			routeId: "100100001",
		});
		expect(result.fetched).toEqual({ getRoutePath: 0, getStaionByRoute: 0 });
		expect(existsSync(stationsFile(dataDir, "100100001"))).toBe(false);
	});

	it("succeeds after a retry and records not-found and error routes", async () => {
		let attempt = 0;
		const { calls, fetchImpl } = fakeFetch((call) => {
			if (call.busRouteId === "100100001" && attempt === 0) {
				attempt += 1;
				return new Response(headerBody("8"), { status: 200 });
			}
			if (call.busRouteId === "100100002") {
				return new Response(headerBody("4"), { status: 200 });
			}
			if (call.busRouteId === "100100003") {
				return new Response("<html>oops</html>", { status: 200 });
			}
			return normalResponder({})(call);
		});
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			retryDelaysMs: NO_RETRY_WAIT,
			routes: [route("100100001"), route("100100002"), route("100100003")],
		});
		expect(calls).toHaveLength(5);
		expect(result.fetched).toEqual({ getRoutePath: 1, getStaionByRoute: 1 });
		expect(result.notFound).toEqual(["100100002"]);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]).toMatchObject({
			kind: "error",
			operation: "getStaionByRoute",
			routeId: "100100003",
		});
		expect(result.stoppedBy).toBeNull();
		expect(await readFile(stationsFile(dataDir, "100100002"), "utf8")).toBe(
			ROUTE_NOT_FOUND_BODY
		);
		expect(existsSync(stationsFile(dataDir, "100100003"))).toBe(false);
	});

	it("saves a not-found marker so reruns skip the route until it goes stale", async () => {
		const routes = [route("100100001"), route("100100002")];
		const notFoundPath = (call: Call) =>
			(call.busRouteId === "100100002" &&
				call.operation === "getStaionByRoute") ||
			(call.busRouteId === "100100001" && call.operation === "getRoutePath");
		const responder = (call: Call) =>
			notFoundPath(call)
				? new Response(headerBody("4"), { status: 200 })
				: normalResponder({})(call);
		const run1 = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: fakeFetch(responder).fetchImpl,
			key: KEY,
			routes,
		});
		expect(run1.notFound).toEqual(["100100001", "100100002"]);
		expect(run1.failed).toEqual([]);
		expect(await readFile(pathFile(dataDir, "100100001"), "utf8")).toBe(
			ROUTE_NOT_FOUND_BODY
		);
		expect(await readFile(stationsFile(dataDir, "100100002"), "utf8")).toBe(
			ROUTE_NOT_FOUND_BODY
		);
		expect(existsSync(pathFile(dataDir, "100100002"))).toBe(false);

		const second = fakeFetch(responder);
		const run2 = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: second.fetchImpl,
			key: KEY,
			routes,
		});
		expect(second.calls).toEqual([]);
		expect(run2.notFound).toEqual(["100100001", "100100002"]);
		expect(run2.failed).toEqual([]);
		expect(run2.skippedFresh).toEqual({ getRoutePath: 1, getStaionByRoute: 2 });
	});

	it("replaces a stale raw with the not-found marker when the route disappears", async () => {
		const routes = [route("100100001")];
		await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: fakeFetch(normalResponder({})).fetchImpl,
			key: KEY,
			routes,
		});
		const now = Date.now();
		const old = new Date(now - 8 * DAY_MS);
		await utimes(stationsFile(dataDir, "100100001"), old, old);

		const gone = fakeFetch(
			() => new Response(headerBody("4"), { status: 200 })
		);
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: gone.fetchImpl,
			key: KEY,
			now: () => new Date(now),
			routes,
		});
		expect(gone.calls).toEqual([
			{ busRouteId: "100100001", operation: "getStaionByRoute" },
		]);
		expect(result.notFound).toEqual(["100100001"]);
		expect(await readFile(stationsFile(dataDir, "100100001"), "utf8")).toBe(
			ROUTE_NOT_FOUND_BODY
		);
	});

	it("stops the operation when rate-limited responses outlast the retries", async () => {
		const { calls, fetchImpl } = fakeFetch(
			() => new Response(headerBody("8"), { status: 200 })
		);
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			retryDelaysMs: NO_RETRY_WAIT,
			routes: [route("100100001"), route("100100002"), route("100100003")],
		});
		expect(calls).toHaveLength(4);
		expect(result.stoppedBy).toBe("rate-limited");
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]).toMatchObject({
			kind: "rate-limited",
			operation: "getStaionByRoute",
			routeId: "100100001",
		});
	});

	it("keeps plain retryable failures per route without stopping", async () => {
		const { calls, fetchImpl } = fakeFetch(
			() => new Response(headerBody("6"), { status: 200 })
		);
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			retryDelaysMs: NO_RETRY_WAIT,
			routes: [route("100100001"), route("100100002")],
		});
		expect(calls).toHaveLength(8);
		expect(result.failed).toHaveLength(2);
		expect(result.stoppedBy).toBeNull();
	});

	it("stops everything on unauthorized and never leaks the key", async () => {
		const { calls, fetchImpl } = fakeFetch(
			(_call, index) =>
				new Response(
					JSON.stringify({
						echo: `http://ws.bus.go.kr/?serviceKey=${ENCODED_KEY}&raw=${KEY}`,
						index,
					}),
					{ status: 401 }
				)
		);
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			retryDelaysMs: NO_RETRY_WAIT,
			routes: [route("100100001"), route("100100002")],
		});
		expect(result.stoppedBy).toBe("unauthorized");
		expect(calls).toHaveLength(1);
		const serialized = JSON.stringify(result);
		const output = logged.join("\n");
		for (const text of [serialized, output]) {
			expect(text).not.toContain(KEY);
			expect(text).not.toContain(ENCODED_KEY);
		}
		expect(existsSync(stationsFile(dataDir, "100100001"))).toBe(false);
	});

	it("never leaks the key from thrown network errors", async () => {
		const fetchImpl = ((input: string | URL | Request) =>
			Promise.reject(
				new Error(`connect failed ${String(input)}`)
			)) as unknown as typeof fetch;
		const result = await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			retryDelaysMs: NO_RETRY_WAIT,
			routes: [route("100100001")],
		});
		expect(result.failed[0]?.kind).toBe("retryable");
		const text = `${JSON.stringify(result)}\n${logged.join("\n")}`;
		expect(text).not.toContain(KEY);
		expect(text).not.toContain(ENCODED_KEY);
	});

	it("respects per-operation budget", async () => {
		const { calls, fetchImpl } = fakeFetch(normalResponder({}));
		const result = await fetchBusRoutes({
			callsPerOperation: 1,
			dataDir,
			delayMs: 0,
			fetchImpl,
			key: KEY,
			routes: [route("100100001"), route("100100002")],
		});
		expect(calls.filter((c) => c.operation === "getStaionByRoute")).toEqual([
			{ busRouteId: "100100001", operation: "getStaionByRoute" },
		]);
		expect(result.stoppedBy).toBe("budget");
		expect(result.fetched.getStaionByRoute).toBe(1);
	});

	it("prints a summary without the key", async () => {
		await fetchBusRoutes({
			dataDir,
			delayMs: 0,
			fetchImpl: fakeFetch(normalResponder({})).fetchImpl,
			key: KEY,
			routes: [route("100100001")],
		});
		const output = logged.join("\n");
		expect(output).toContain("routes: 1");
		expect(output).toContain("stoppedBy: none");
		expect(output).not.toContain(KEY);
		expect(output).not.toContain(ENCODED_KEY);
	});
});

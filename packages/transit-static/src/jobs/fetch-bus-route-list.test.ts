import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPath } from "../paths";
import { ROUTE_LIST_SEARCH_TERMS } from "../sources/seoul-bus-route-list";
import {
	BUS_ROUTE_LIST_SOURCE,
	fetchBusRouteList,
	latestRouteList,
} from "./fetch-bus-route-list";

const KEY = "a/b+c==";
const NOW = new Date("2026-11-10T03:00:00Z");
const DAY_MS = 86_400_000;

function body(items: Record<string, string>[]): string {
	return JSON.stringify({
		msgBody: { itemList: items },
		msgHeader: { headerCd: "0", headerMsg: "ok", itemCount: items.length },
	});
}

function item(id: string): Record<string, string> {
	return {
		busRouteAbrv: id,
		busRouteId: id,
		busRouteNm: id,
		routeType: "8",
	};
}

function fakeFetch(responder: (term: string, index: number) => Response) {
	const terms: string[] = [];
	const urls: string[] = [];
	const fetchImpl = ((input: string | URL | Request) => {
		const url = new URL(String(input));
		urls.push(String(input));
		terms.push(url.searchParams.get("strSrch") ?? "");
		return Promise.resolve(
			responder(url.searchParams.get("strSrch") ?? "", terms.length - 1)
		);
	}) as unknown as typeof fetch;
	return { fetchImpl, terms, urls };
}

function dateDir(daysAgo: number): string {
	return new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

let dataDir: string;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "bus-route-list-"));
	logSpy = spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
	logSpy.mockRestore();
	await rm(dataDir, { force: true, recursive: true });
});

async function seed(daysAgo: number, term: string, items: string[]) {
	const dir = rawPath(dataDir, BUS_ROUTE_LIST_SOURCE, dateDir(daysAgo));
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${term}.json`), body(items.map(item)));
}

describe("fetchBusRouteList", () => {
	it("calls every search term once and writes raw files and routes.json", async () => {
		const { fetchImpl, terms } = fakeFetch((term) =>
			Response.json(JSON.parse(body([item(`id-${term}`), item("shared")])))
		);
		const result = await fetchBusRouteList({
			dataDir,
			fetchImpl,
			key: KEY,
			now: () => NOW,
		});
		expect(result.calls).toBe(16);
		expect(result.stoppedBy).toBe("none");
		expect(terms).toEqual([...ROUTE_LIST_SEARCH_TERMS]);
		expect(result.routes).toHaveLength(17);

		const dir = rawPath(dataDir, BUS_ROUTE_LIST_SOURCE, dateDir(0));
		const raw = await readFile(join(dir, "마을.json"), "utf8");
		expect(raw).not.toContain(KEY);
		const merged = await readFile(join(dir, "routes.json"), "utf8");
		expect(merged).not.toContain(KEY);
		expect(latestRouteList(dataDir)).toEqual(result.routes);
	});

	it("stops on 401 without calling the remaining terms and hides the key", async () => {
		const { fetchImpl, terms } = fakeFetch((_term, index) =>
			index === 2
				? new Response(`bad key ${KEY} ${encodeURIComponent(KEY)}`, {
						status: 401,
					})
				: Response.json(JSON.parse(body([item(`id-${index}`)])))
		);
		const result = await fetchBusRouteList({
			dataDir,
			fetchImpl,
			key: KEY,
			now: () => NOW,
		});
		expect(result.stoppedBy).toBe("unauthorized");
		expect(result.calls).toBe(3);
		expect(terms).toHaveLength(3);
		expect(JSON.stringify(result)).not.toContain(KEY);
		expect(JSON.stringify(result)).not.toContain(encodeURIComponent(KEY));
		for (const [line] of logSpy.mock.calls) {
			expect(String(line)).not.toContain(KEY);
		}
	});

	it("skips terms fetched 6 days ago and refetches those from 8 days ago", async () => {
		await seed(6, "0", ["old-0"]);
		await seed(8, "1", ["old-1"]);
		const { fetchImpl, terms } = fakeFetch(() =>
			Response.json(JSON.parse(body([item("new")])))
		);
		const result = await fetchBusRouteList({
			dataDir,
			fetchImpl,
			key: KEY,
			now: () => NOW,
		});
		expect(terms).not.toContain("0");
		expect(terms).toContain("1");
		expect(result.calls).toBe(15);
		expect(result.routes.map((row) => row.busRouteId)).toContain("old-0");
		expect(result.routes.map((row) => row.busRouteId)).not.toContain("old-1");
	});

	it("uses the strSrch parameter and the getBusRouteList operation", async () => {
		const { fetchImpl, urls } = fakeFetch(() =>
			Response.json(JSON.parse(body([item("x")])))
		);
		await fetchBusRouteList({
			dataDir,
			fetchImpl,
			key: KEY,
			now: () => NOW,
			terms: ["M"],
		});
		expect(urls[0]).toContain("/getBusRouteList?");
		expect(urls[0]).toContain("strSrch=M");
	});
});

describe("latestRouteList", () => {
	it("returns null when nothing was fetched", () => {
		expect(latestRouteList(dataDir)).toBeNull();
	});
});

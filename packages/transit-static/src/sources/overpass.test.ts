import { describe, expect, it } from "bun:test";
import {
	discoverQuery,
	fetchOverpass,
	routeQuery,
	SEOUL_METRO_BBOX,
} from "./overpass";

const STATUS_429 = /429/;

describe("queries", () => {
	it("routeQuery lists ids and recurses down", () => {
		const q = routeQuery([1, 22, 333]);
		expect(q).toContain("relation(id:1,22,333)");
		expect(q).toContain("(._;>;)");
		expect(q).toContain("[out:json]");
	});
	it("discoverQuery filters route types inside the bbox", () => {
		const q = discoverQuery(SEOUL_METRO_BBOX);
		expect(q).toContain("subway|train|light_rail");
		expect(q).toContain("36.7,126.3,38,127.9");
	});
});

describe("fetchOverpass", () => {
	it("posts form-encoded data and throws on non-200", async () => {
		let seen: { method?: string; body?: string } = {};
		const okFetch = ((_url: unknown, init?: RequestInit) => {
			seen = { body: String(init?.body), method: init?.method };
			return Promise.resolve(
				new Response(JSON.stringify({ elements: [] }), { status: 200 })
			);
		}) as unknown as typeof fetch;
		expect(await fetchOverpass("[out:json];", okFetch)).toEqual({
			elements: [],
		});
		expect(seen.method).toBe("POST");
		expect(seen.body).toBe("data=%5Bout%3Ajson%5D%3B");
		const badFetch = (async () =>
			new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
		await expect(fetchOverpass("x", badFetch)).rejects.toThrow(STATUS_429);
	});
});

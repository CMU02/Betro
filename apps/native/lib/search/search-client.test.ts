import { describe, expect, it } from "bun:test";
import { createMapRefCache } from "@/lib/map/map-client";
import type { ServerClient, ServerResponse } from "@/lib/server/api-client";
import { loadSearchIndex } from "./search-client";

const INDEX = {
	routes: [
		{
			line: "seoul-bus:100100118",
			name: "146",
			routeType: "3",
			shortName: "146",
		},
	],
	stations: [
		{
			key: "seoul-subway:1002000222",
			lat: 37.49,
			lng: 127.02,
			members: [
				{ line: "seoul-subway:line2", stop: "seoul-subway:1002000222" },
			],
			name: "강남",
		},
	],
	stops: [
		{
			arsId: "01234",
			lat: 37.5,
			lng: 127,
			name: "정류장",
			stop: "seoul-bus:111",
			towards: null,
		},
	],
};

function memoryCache() {
	const map = new Map<string, string>();
	return createMapRefCache({
		getItem: (k) => Promise.resolve(map.get(k) ?? null),
		setItem: (k, v) => {
			map.set(k, v);
			return Promise.resolve();
		},
	});
}

function clientOf(responses: ServerResponse[]): {
	client: ServerClient;
	etags: (string | undefined)[];
} {
	const etags: (string | undefined)[] = [];
	let i = 0;
	return {
		client: {
			request: (_m, _p, _b, options) => {
				etags.push(options?.headers?.["If-None-Match"]);
				const r = responses[Math.min(i, responses.length - 1)];
				i += 1;
				return Promise.resolve(r as ServerResponse);
			},
		},
		etags,
	};
}

describe("loadSearchIndex", () => {
	it("색인은 ETag 304면 캐시를 쓰고, 오프라인이어도 캐시가 있으면 캐시를 쓴다", async () => {
		const cache = memoryCache();
		const { client, etags } = clientOf([
			{ etag: '"search-1-2"', json: INDEX, status: 200 },
			{ etag: null, json: null, status: 304 },
			{ etag: null, json: null, status: 0 },
		] as unknown as ServerResponse[]);
		expect(await loadSearchIndex(client, cache)).toEqual(INDEX);
		expect(await loadSearchIndex(client, cache)).toEqual(INDEX);
		expect(await loadSearchIndex(client, cache)).toEqual(INDEX);
		expect(etags).toEqual([undefined, '"search-1-2"', '"search-1-2"']);
	});

	it("오프라인이고 캐시가 없으면 throw한다", async () => {
		const { client } = clientOf([
			{ etag: null, json: null, status: 0 },
		] as unknown as ServerResponse[]);
		await expect(loadSearchIndex(client, memoryCache())).rejects.toThrow();
	});
});

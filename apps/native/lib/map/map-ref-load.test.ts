import { expect, it } from "bun:test";
import type { MapRefCache } from "./map-client";
import { loadCachedRef } from "./map-client";

function memoryCache(initial?: {
	etag: string;
	value: unknown;
}): MapRefCache & { entry: { etag: string; value: unknown } | null } {
	const holder = { entry: initial ?? null };
	return {
		get entry() {
			return holder.entry;
		},
		get: <T>() =>
			Promise.resolve(holder.entry as { etag: string; value: T } | null),
		set: (_key, etag, value) => {
			holder.entry = { etag, value };
			return Promise.resolve();
		},
	};
}

it("sends the cached etag and keeps the cached value on not-modified", async () => {
	const cache = memoryCache({ etag: '"v1"', value: { n: 1 } });
	const seen: (string | null)[] = [];
	const value = await loadCachedRef(cache, "k", (etag) => {
		seen.push(etag);
		return Promise.resolve({ ok: true, value: "not-modified" } as const);
	});
	expect(value).toEqual({ n: 1 });
	expect(seen).toEqual(['"v1"']);
});

it("stores the server etag with a fresh body", async () => {
	const cache = memoryCache();
	const seen: (string | null)[] = [];
	const value = await loadCachedRef(cache, "k", (etag) => {
		seen.push(etag);
		return Promise.resolve({
			ok: true,
			value: { etag: '"busmap-3"', value: { n: 2 } },
		} as const);
	});
	expect(value).toEqual({ n: 2 });
	expect(seen).toEqual([null]);
	expect(cache.entry).toEqual({ etag: '"busmap-3"', value: { n: 2 } });
});

it("falls back to the cache on failure and throws without one", async () => {
	const failing = () =>
		Promise.resolve({ ok: false, reason: "offline" } as const);
	const cached = memoryCache({ etag: '"v1"', value: { n: 1 } });
	expect(await loadCachedRef(cached, "k", failing)).toEqual({ n: 1 });
	await expect(loadCachedRef(memoryCache(), "k", failing)).rejects.toThrow();
});

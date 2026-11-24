import { expect, it } from "bun:test";

import { FAVORITES_KEY, type Favorite, parseFavorites } from "./favorites";
import { createFavoritesStore } from "./favorites-store";

function memoryKv() {
	const map = new Map<string, string>();
	return {
		kv: {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => {
				map.set(k, v);
			},
		},
		map,
	};
}

const route = (line: string, addedAt = 1): Favorite => ({
	addedAt,
	id: `route:${line}`,
	kind: "route",
	line,
	name: "146",
	routeType: "간선",
	shortName: "146",
});

it("toggle은 더하고 다시 누르면 지운다", () => {
	const { kv, map } = memoryKv();
	const store = createFavoritesStore(kv);
	const fav = route("seoul-bus:1");
	expect(store.toggle(fav)).toBe(true);
	expect(store.has(fav.id)).toBe(true);
	expect(parseFavorites(map.get(FAVORITES_KEY) ?? null)).toEqual([fav]);
	expect(store.toggle(fav)).toBe(false);
	expect(store.has(fav.id)).toBe(false);
	expect(store.get()).toEqual([]);
});

it("새 것이 앞에 온다", () => {
	const { kv } = memoryKv();
	const store = createFavoritesStore(kv);
	store.toggle(route("seoul-bus:1"));
	store.toggle(route("seoul-bus:2"));
	expect(store.get().map((f) => f.id)).toEqual([
		"route:seoul-bus:2",
		"route:seoul-bus:1",
	]);
});

it("remove는 지우고 구독자에게 알린다", () => {
	const { kv } = memoryKv();
	const store = createFavoritesStore(kv);
	let calls = 0;
	const off = store.subscribe(() => {
		calls += 1;
	});
	store.toggle(route("seoul-bus:1"));
	store.remove("route:seoul-bus:1");
	expect(store.get()).toEqual([]);
	expect(calls).toBe(2);
	off();
	store.toggle(route("seoul-bus:3"));
	expect(calls).toBe(2);
});

it("저장된 값으로 시작하고 옛 gbis 값은 버린다", () => {
	const { kv } = memoryKv();
	kv.setItem(
		FAVORITES_KEY,
		JSON.stringify({
			favorites: [route("gbis:9"), route("seoul-bus:1")],
			version: 1,
		})
	);
	expect(
		createFavoritesStore(kv)
			.get()
			.map((f) => f.id)
	).toEqual(["route:seoul-bus:1"]);
});

it("저장이 실패해도 메모리 값으로 동작한다", () => {
	const store = createFavoritesStore({
		getItem: () => {
			throw new Error("read");
		},
		setItem: () => {
			throw new Error("write");
		},
	});
	expect(store.toggle(route("seoul-bus:1"))).toBe(true);
	expect(store.has("route:seoul-bus:1")).toBe(true);
});

import { expect, it } from "bun:test";

import { createRecentsStore, RECENTS_KEY, RECENTS_MAX } from "./recents-store";
import type { SearchTarget } from "./search-model";

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

const stopTarget = (n: number): SearchTarget => ({
	kind: "stop",
	name: `정류장${n}`,
	stop: `seoul-bus:${n}`,
});

it("최근 검색은 같은 대상을 맨 앞으로 옮기고 8개까지다", () => {
	const { kv } = memoryKv();
	const store = createRecentsStore(kv);
	for (let i = 0; i < 10; i++) {
		store.add(stopTarget(i));
	}
	expect(store.get()).toHaveLength(RECENTS_MAX);
	expect(store.get()[0]).toEqual(stopTarget(9));
	store.add(stopTarget(5));
	expect(store.get()[0]).toEqual(stopTarget(5));
	expect(
		store.get().filter((t) => t.kind === "stop" && t.stop === "seoul-bus:5")
	).toHaveLength(1);
	expect(createRecentsStore(kv).get()).toEqual(store.get());
});

it("gbis 대상이 저장돼 있어도 읽을 때 버린다", () => {
	const { kv, map } = memoryKv();
	map.set(
		RECENTS_KEY,
		JSON.stringify([
			{ kind: "route", line: "gbis:1", name: "g", shortName: "g" },
			{ kind: "stop", name: "t", stop: "tago:1" },
			stopTarget(1),
		])
	);
	expect(createRecentsStore(kv).get()).toEqual([stopTarget(1)]);
});

it("깨진 저장값은 빈 목록이고 clear와 구독이 동작한다", () => {
	const { kv, map } = memoryKv();
	map.set(RECENTS_KEY, "{oops");
	const store = createRecentsStore(kv);
	expect(store.get()).toEqual([]);
	let calls = 0;
	const off = store.subscribe(() => {
		calls += 1;
	});
	store.add(stopTarget(1));
	store.clear();
	off();
	store.add(stopTarget(2));
	expect(calls).toBe(2);
	expect(store.get()).toEqual([stopTarget(2)]);
});

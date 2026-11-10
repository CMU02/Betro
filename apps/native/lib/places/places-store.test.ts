import type { CommutePlan } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import { PLACES_KEY, type Place, parsePlacesState } from "./places";
import { createPlacesStore } from "./places-store";

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

function planOf(planId: string): CommutePlan {
	return {
		enabled: true,
		planId,
		routes: [
			{
				legs: [
					{
						alight: { name: "강남", stop: "seoul-subway:0222" },
						board: { name: "잠실", stop: "seoul-subway:0216" },
						direction: "down",
						line: "seoul-subway:1002",
						lineName: "2호선",
						mode: "subway",
					},
				],
				rank: 0,
				walkMinutes: [5, 5],
			},
		],
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: 10,
			leaveMinute: 485,
			timezone: "Asia/Seoul",
		},
	};
}

const WORK_PLAN = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";
const HOME_PLAN = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

function place(id: string, planId: string, overrides: Partial<Place> = {}) {
	const base: Place = {
		id,
		kind: "work",
		name: "회사",
		plan: planOf(planId),
		sync: "pending",
		updatedAt: 1000,
	};
	return { ...base, ...overrides };
}

function counter(store: ReturnType<typeof createPlacesStore>) {
	const calls = { count: 0 };
	const unsubscribe = store.subscribe(() => {
		calls.count += 1;
	});
	return { calls, unsubscribe };
}

it("starts empty", () => {
	expect(createPlacesStore(memoryKv().kv).get()).toEqual({
		pendingDeletes: [],
		places: [],
	});
});

it("upserts by id and persists", () => {
	const { kv, map } = memoryKv();
	const store = createPlacesStore(kv);
	const work = place("work", WORK_PLAN);
	store.upsert(work);
	store.upsert(place("home", HOME_PLAN, { kind: "home", name: "집" }));
	const renamed = { ...work, name: "본사", updatedAt: 2000 };
	store.upsert(renamed);
	expect(store.get().places.map((p) => [p.id, p.name])).toEqual([
		["work", "본사"],
		["home", "집"],
	]);
	expect(parsePlacesState(map.get(PLACES_KEY) ?? null)).toEqual(store.get());
});

it("queues the plan of a removed place for deletion", () => {
	const store = createPlacesStore(memoryKv().kv);
	store.upsert(place("work", WORK_PLAN));
	store.remove("work");
	expect(store.get()).toEqual({ pendingDeletes: [WORK_PLAN], places: [] });
	store.clearPendingDelete(WORK_PLAN);
	expect(store.get().pendingDeletes).toEqual([]);
});

it("marks a place synced only when its updatedAt still matches", () => {
	const store = createPlacesStore(memoryKv().kv);
	store.upsert(place("work", WORK_PLAN, { updatedAt: 2000 }));
	store.markSynced("work", 1000);
	expect(store.get().places[0]?.sync).toBe("pending");
	store.markSynced("work", 2000);
	expect(store.get().places[0]?.sync).toBe("synced");
});

it("notifies subscribers only when the state changes", () => {
	const store = createPlacesStore(memoryKv().kv);
	const { calls, unsubscribe } = counter(store);
	const work = place("work", WORK_PLAN);

	store.upsert(work);
	expect(calls.count).toBe(1);
	store.upsert({ ...work });
	expect(calls.count).toBe(1);

	store.markSynced("work", work.updatedAt);
	expect(calls.count).toBe(2);
	store.markSynced("work", work.updatedAt);
	store.markSynced("missing", work.updatedAt);
	expect(calls.count).toBe(2);

	store.remove("missing");
	store.clearPendingDelete(HOME_PLAN);
	expect(calls.count).toBe(2);

	store.remove("work");
	expect(calls.count).toBe(3);
	store.clearPendingDelete(WORK_PLAN);
	expect(calls.count).toBe(4);

	store.replace({ pendingDeletes: [], places: [] });
	expect(calls.count).toBe(4);
	store.replace({ pendingDeletes: [HOME_PLAN], places: [work] });
	expect(calls.count).toBe(5);

	unsubscribe();
	store.replace({ pendingDeletes: [], places: [] });
	expect(calls.count).toBe(5);
});

it("keeps the state for a new store on the same kv", () => {
	const { kv } = memoryKv();
	const store = createPlacesStore(kv);
	store.upsert(place("work", WORK_PLAN));
	store.upsert(place("home", HOME_PLAN, { kind: "home", name: "집" }));
	store.remove("home");
	expect(createPlacesStore(kv).get()).toEqual(store.get());
});

it("keeps working in memory when storage throws", () => {
	const store = createPlacesStore({
		getItem: () => {
			throw new Error("disk error");
		},
		setItem: () => {
			throw new Error("disk full");
		},
	});
	store.upsert(place("work", WORK_PLAN));
	expect(store.get().places).toHaveLength(1);
});

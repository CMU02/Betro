import { expect, it } from "bun:test";

import { PREFERENCES_KEY, parsePreferences } from "./preferences";
import { createPreferencesStore } from "./preferences-store";

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

it("persists updates and notifies subscribers", () => {
	const { map, kv } = memoryKv();
	const store = createPreferencesStore(kv);
	let calls = 0;
	const unsubscribe = store.subscribe(() => {
		calls += 1;
	});
	store.update({ themeMode: "light" });
	expect(store.get().themeMode).toBe("light");
	expect(parsePreferences(map.get(PREFERENCES_KEY) ?? null).themeMode).toBe(
		"light"
	);
	expect(calls).toBe(1);
	unsubscribe();
	store.update({ dataSaver: true });
	expect(calls).toBe(1);
	expect(createPreferencesStore(kv).get().dataSaver).toBe(true);
});

it("starts with defaults and keeps working when storage throws", () => {
	const failing = {
		getItem: () => {
			throw new Error("disk error");
		},
		setItem: () => {
			throw new Error("disk full");
		},
	};
	const store = createPreferencesStore(failing);
	expect(store.get().themeMode).toBe("system");
	expect(store.update({ themeMode: "dark" }).themeMode).toBe("dark");
});

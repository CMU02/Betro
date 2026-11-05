import { expect, it } from "bun:test";

import { DEFAULT_PREFERENCES } from "@/lib/preferences/preferences";
import {
	createPreferencesStore,
	type SyncKeyValue,
} from "@/lib/preferences/preferences-store";

import {
	canSkipToApp,
	completeOnboarding,
	shouldShowOnboarding,
} from "./onboarding";

function memoryKv(): SyncKeyValue {
	const map = new Map<string, string>();
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
	};
}

it("shows onboarding until it is completed", () => {
	expect(shouldShowOnboarding(DEFAULT_PREFERENCES)).toBe(true);
	expect(
		shouldShowOnboarding({ ...DEFAULT_PREFERENCES, onboardingCompleted: true })
	).toBe(false);
});

it("completes onboarding even when both permissions are denied", () => {
	const store = createPreferencesStore(memoryKv());
	expect(canSkipToApp({ location: "denied", notifications: "denied" })).toBe(
		true
	);
	completeOnboarding(store);
	expect(shouldShowOnboarding(store.get())).toBe(false);
});

it("keeps onboarding completed after the app restarts", () => {
	const kv = memoryKv();
	completeOnboarding(createPreferencesStore(kv));
	expect(shouldShowOnboarding(createPreferencesStore(kv).get())).toBe(false);
});

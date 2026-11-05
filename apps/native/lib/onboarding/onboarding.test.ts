import { expect, it } from "bun:test";

import { DEFAULT_PREFERENCES } from "@/lib/preferences/preferences";
import {
	createPreferencesStore,
	type SyncKeyValue,
} from "@/lib/preferences/preferences-store";

import {
	canSkipToApp,
	completeOnboarding,
	permissionButtonAction,
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

it("requests a permission until a request in this session was denied", () => {
	expect(permissionButtonAction("undetermined", false)).toBe("request");
	// Android 13+는 묻기 전에도 "denied"로 읽히므로 처음에는 시스템 창을 띄운다.
	expect(permissionButtonAction("denied", false)).toBe("request");
	// 요청했는데 거부로 돌아오면 다시 물어도 창이 뜨지 않으므로 설정으로 보낸다.
	expect(permissionButtonAction("denied", true)).toBe("openSettings");
	expect(permissionButtonAction("granted", false)).toBe("none");
	expect(permissionButtonAction("granted", true)).toBe("none");
});

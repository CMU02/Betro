import { expect, it } from "bun:test";

import type { PermissionStatus } from "../onboarding/onboarding";
import { createLockScreenStatusStore } from "./lock-screen-status";

function readers(initial: { activities: boolean; push: PermissionStatus }) {
	const current: {
		activities: boolean;
		fail: boolean;
		push: PermissionStatus;
	} = {
		...initial,
		fail: false,
	};
	return {
		current,
		deps: {
			readActivitiesEnabled: () => current.activities,
			readPushStatus: () =>
				current.fail
					? Promise.reject(new Error("not ready"))
					: Promise.resolve(current.push),
		},
	};
}

it("is unknown until the first read", () => {
	const store = createLockScreenStatusStore(
		readers({ activities: true, push: "granted" }).deps
	);
	expect(store.get()).toBeNull();
});

it("reads both states and tells subscribers when they change", async () => {
	const { current, deps } = readers({ activities: true, push: "denied" });
	const store = createLockScreenStatusStore(deps);
	let notified = 0;
	store.subscribe(() => {
		notified += 1;
	});

	expect(await store.refresh()).toEqual({
		activitiesEnabled: true,
		pushStatus: "denied",
	});
	await store.refresh();
	expect(notified).toBe(1);

	current.push = "granted";
	await store.refresh();
	expect(store.get()?.pushStatus).toBe("granted");
	expect(notified).toBe(2);
});

it("keeps the last state when a read fails", async () => {
	const { current, deps } = readers({ activities: false, push: "granted" });
	const store = createLockScreenStatusStore(deps);
	await store.refresh();
	current.fail = true;

	expect(await store.refresh()).toEqual({
		activitiesEnabled: false,
		pushStatus: "granted",
	});
});

it("stops notifying an unsubscribed listener", async () => {
	const { deps } = readers({ activities: true, push: "granted" });
	const store = createLockScreenStatusStore(deps);
	let notified = 0;
	const unsubscribe = store.subscribe(() => {
		notified += 1;
	});
	unsubscribe();
	await store.refresh();
	expect(notified).toBe(0);
});

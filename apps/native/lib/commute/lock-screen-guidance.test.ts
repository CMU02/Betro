import { describe, expect, it } from "bun:test";

import {
	endLocalGuidance,
	setLockScreenGuidance,
} from "./lock-screen-guidance";

function recorder(options: { endFails?: boolean } = {}) {
	const events: string[] = [];
	return {
		deps: {
			endLocal: () => {
				events.push("endLocal");
				return options.endFails
					? Promise.reject(new Error("no module"))
					: Promise.resolve();
			},
			sync: () => {
				events.push("sync");
				return Promise.resolve();
			},
			update: (enabled: boolean) => {
				events.push(`update:${enabled}`);
			},
		},
		events,
	};
}

it("turning it off saves the choice, ends what is on screen and tells the server", async () => {
	const { deps, events } = recorder();

	await setLockScreenGuidance(false, deps);

	expect(events).toEqual(["update:false", "endLocal", "sync"]);
});

it("turning it on saves the choice and tells the server without ending anything", async () => {
	const { deps, events } = recorder();

	await setLockScreenGuidance(true, deps);

	expect(events).toEqual(["update:true", "sync"]);
});

it("still tells the server when ending the local guidance fails", async () => {
	const { deps, events } = recorder({ endFails: true });

	await setLockScreenGuidance(false, deps);

	expect(events).toEqual(["update:false", "endLocal", "sync"]);
});

describe("endLocalGuidance", () => {
	function enders(options: { notifier?: "throws" | null } = {}) {
		const events: string[] = [];
		return {
			enders: {
				endActivities: () => {
					events.push("endActivities");
					return Promise.resolve();
				},
				notifier:
					options.notifier === null
						? null
						: {
								endAll: () => {
									events.push("notifier.endAll");
									if (options.notifier === "throws") {
										throw new Error("missing in this build");
									}
								},
							},
			},
			events,
		};
	}

	it("ends the Live Activities on iOS", async () => {
		const { enders: deps, events } = enders();

		await endLocalGuidance("ios", deps);

		expect(events).toEqual(["endActivities"]);
	});

	it("removes the ongoing notification on Android", async () => {
		const { enders: deps, events } = enders();

		await endLocalGuidance("android", deps);

		expect(events).toEqual(["notifier.endAll"]);
	});

	it("does nothing on Android without the notification module", async () => {
		const { enders: deps, events } = enders({ notifier: null });

		await endLocalGuidance("android", deps);

		expect(events).toEqual([]);
	});

	it("rejects instead of throwing when the notifier throws, so the server still hears it", async () => {
		const { enders: localEnders } = enders({ notifier: "throws" });
		const { deps, events } = recorder();

		await setLockScreenGuidance(false, {
			...deps,
			endLocal: () => {
				events.push("endLocal");
				return endLocalGuidance("android", localEnders);
			},
		});

		expect(events).toEqual(["update:false", "endLocal", "sync"]);
	});
});

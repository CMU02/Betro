import { expect, it } from "bun:test";

import { setLockScreenGuidance } from "./lock-screen-guidance";

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

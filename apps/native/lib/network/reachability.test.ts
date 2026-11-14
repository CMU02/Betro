import { expect, it } from "bun:test";

import {
	createReachability,
	onReconnect,
	startOfflineProbe,
} from "./reachability";

it("starts online and tells listeners only when the state changes", () => {
	const reachability = createReachability();
	const seen: boolean[] = [];
	reachability.subscribe(() => seen.push(reachability.isOffline()));

	expect(reachability.isOffline()).toBe(false);
	reachability.report(true);
	reachability.report(false);
	reachability.report(false);
	reachability.report(true);

	expect(seen).toEqual([true, false]);
});

it("stops telling a listener after it unsubscribes", () => {
	const reachability = createReachability();
	let calls = 0;
	const unsubscribe = reachability.subscribe(() => {
		calls += 1;
	});
	unsubscribe();
	reachability.report(false);

	expect(calls).toBe(0);
});

interface FakeTimers {
	clear: (id: number) => void;
	fire: () => Promise<void>;
	pending: () => number;
	set: (run: () => void, ms: number) => number;
}

function fakeTimers(): FakeTimers {
	const timers = new Map<number, () => void>();
	let next = 1;
	return {
		clear: (id) => {
			timers.delete(id);
		},
		async fire() {
			const due = [...timers.entries()];
			timers.clear();
			for (const [, run] of due) {
				run();
			}
			// 탐침의 await 뒤 이어지는 일을 끝낸다.
			await Promise.resolve();
			await Promise.resolve();
		},
		pending: () => timers.size,
		set: (run) => {
			const id = next;
			next += 1;
			timers.set(id, run);
			return id;
		},
	};
}

it("probes only while offline and stops once a probe gets through", async () => {
	const reachability = createReachability();
	const timers = fakeTimers();
	let probes = 0;
	let reachable = false;
	const stop = startOfflineProbe({
		intervalMs: 10_000,
		probe: () => {
			probes += 1;
			reachability.report(reachable);
			return Promise.resolve();
		},
		reachability,
		timers,
	});

	expect(timers.pending()).toBe(0);
	reachability.report(false);
	expect(timers.pending()).toBe(1);

	await timers.fire();
	expect(probes).toBe(1);
	expect(timers.pending()).toBe(1);

	reachable = true;
	await timers.fire();
	expect(probes).toBe(2);
	expect(reachability.isOffline()).toBe(false);
	expect(timers.pending()).toBe(0);

	stop();
});

it("clears the waiting probe when stopped", () => {
	const reachability = createReachability();
	const timers = fakeTimers();
	const stop = startOfflineProbe({
		intervalMs: 10_000,
		probe: () => Promise.resolve(),
		reachability,
		timers,
	});
	reachability.report(false);
	stop();

	expect(timers.pending()).toBe(0);
});

it("runs the reconnect callback only when an offline spell ends", () => {
	const reachability = createReachability();
	let runs = 0;
	onReconnect(reachability, () => {
		runs += 1;
	});

	reachability.report(true);
	expect(runs).toBe(0);
	reachability.report(false);
	expect(runs).toBe(0);
	reachability.report(true);
	reachability.report(true);
	expect(runs).toBe(1);
	reachability.report(false);
	reachability.report(true);
	expect(runs).toBe(2);
});

it("stops running the reconnect callback after it is removed", () => {
	const reachability = createReachability();
	let runs = 0;
	const stop = onReconnect(reachability, () => {
		runs += 1;
	});
	stop();
	reachability.report(false);
	reachability.report(true);

	expect(runs).toBe(0);
});

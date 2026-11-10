import { expect, it } from "bun:test";

import type { CrashSink } from "../crash/crash-reporting";
import { createSyncFlow } from "./sync-flow";

function recordingSink() {
	const errors: { context: string | undefined; message: string }[] = [];
	const sink: CrashSink = {
		recordError: (error, context) => {
			errors.push({ context, message: error.message });
		},
		setInstallId: () => {
			// 기록하지 않는다.
		},
		start: () => {
			// 시작하지 않는다.
		},
	};
	return { errors, sink };
}

/** 부를 때마다 끝나지 않은 약속을 하나 만들고, 테스트가 차례로 끝낸다. */
function controlledReconcile() {
	const resolvers: (() => void)[] = [];
	return {
		calls: () => resolvers.length,
		finish: (index: number) => {
			resolvers[index]?.();
		},
		reconcile: () =>
			new Promise<void>((resolve) => {
				resolvers.push(resolve);
			}),
	};
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

it("runs reconcile once per call when calls do not overlap", async () => {
	let calls = 0;
	const flow = createSyncFlow({
		reconcile: () => {
			calls += 1;
			return Promise.resolve();
		},
		sink: recordingSink().sink,
	});

	await flow.run();
	await flow.run();
	expect(calls).toBe(2);
});

it("does not start a second reconcile while one is running", async () => {
	const control = controlledReconcile();
	const flow = createSyncFlow({
		reconcile: control.reconcile,
		sink: recordingSink().sink,
	});

	const first = flow.run();
	const second = flow.run();
	const third = flow.run();
	await flush();
	expect(control.calls()).toBe(1);

	control.finish(0);
	await flush();
	expect(control.calls()).toBe(2);

	control.finish(1);
	await Promise.all([first, second, third]);
	expect(control.calls()).toBe(2);
});

it("reports a failed reconcile with the places-sync context and does not throw", async () => {
	const { errors, sink } = recordingSink();
	const flow = createSyncFlow({
		reconcile: () => Promise.reject(new Error("disk full")),
		sink,
	});

	await flow.run();
	expect(errors).toEqual([{ context: "places-sync", message: "disk full" }]);
});

it("runs again after a failure", async () => {
	let calls = 0;
	const flow = createSyncFlow({
		reconcile: () => {
			calls += 1;
			return calls === 1
				? Promise.reject(new Error("boom"))
				: Promise.resolve();
		},
		sink: recordingSink().sink,
	});

	await flow.run();
	await flow.run();
	expect(calls).toBe(2);
});

it("does not report an offline result", async () => {
	const { errors, sink } = recordingSink();
	const flow = createSyncFlow({
		reconcile: () => Promise.resolve("offline" as const),
		sink,
	});

	await flow.run();
	expect(errors).toEqual([]);
});

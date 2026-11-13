import { expect, it } from "bun:test";

import type { CrashSink } from "../crash/crash-reporting";
import type { MessageKey } from "../i18n/translate";
import type { SaveResult } from "./plan-sync";
import { runSave, type SaveFlowDeps } from "./save-flow";

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

/** 저장 한 번을 끝나지 않은 채로 두고, 테스트가 결과를 정해 끝낸다. */
function controlledSave() {
	let resolveSave: ((result: SaveResult) => void) | null = null;
	let rejectSave: ((error: Error) => void) | null = null;
	let calls = 0;
	return {
		calls: () => calls,
		fail: (error: Error) => rejectSave?.(error),
		finish: (result: SaveResult) => resolveSave?.(result),
		save: () => {
			calls += 1;
			return new Promise<SaveResult>((resolve, reject) => {
				resolveSave = resolve;
				rejectSave = reject;
			});
		},
	};
}

function harness() {
	const control = controlledSave();
	const { errors, sink } = recordingSink();
	const state = {
		closes: 0,
		errorShown: [] as (MessageKey | null)[],
		open: true,
		saving: [] as boolean[],
	};
	const lock = { current: false };
	const deps: SaveFlowDeps = {
		close: () => {
			state.closes += 1;
		},
		isOpen: () => state.open,
		lock,
		save: control.save,
		setSaving: (saving) => {
			state.saving.push(saving);
		},
		showError: (message) => {
			state.errorShown.push(message);
		},
		sink,
	};
	return { control, deps, errors, lock, state };
}

it("closes once when the form is still open and the save lands", async () => {
	const { control, deps, state } = harness();
	const running = runSave(deps);
	control.finish("saved");
	await running;
	expect(state.closes).toBe(1);
	expect(state.errorShown).toEqual([null]);
});

it("keeps the form locked after closing so nothing reopens during the exit", async () => {
	const { control, deps, lock, state } = harness();
	const running = runSave(deps);
	control.finish("pending");
	await running;
	expect(state.closes).toBe(1);
	expect(lock.current).toBe(true);
	expect(state.saving).toEqual([true]);
});

it("does not close another screen when the form left during the save", async () => {
	const { control, deps, state } = harness();
	const running = runSave(deps);
	state.open = false;
	control.finish("saved");
	await running;
	expect(state.closes).toBe(0);
});

it("does not show an error on a form that left during the save", async () => {
	const { control, deps, state } = harness();
	const running = runSave(deps);
	state.open = false;
	control.finish("limit");
	await running;
	expect(state.errorShown).toEqual([null]);
	expect(state.closes).toBe(0);
});

it("shows the error and unlocks when the server refuses", async () => {
	const { control, deps, lock, state } = harness();
	const running = runSave(deps);
	control.finish("limit");
	await running;
	expect(state.errorShown).toEqual([null, "placeSetup.save.limit"]);
	expect(state.closes).toBe(0);
	expect(lock.current).toBe(false);
	expect(state.saving).toEqual([true, false]);
});

it("starts no second save while one is running", async () => {
	const { control, deps, state } = harness();
	const first = runSave(deps);
	await runSave(deps);
	expect(control.calls()).toBe(1);
	control.finish("saved");
	await first;
	expect(state.closes).toBe(1);
});

it("does nothing when the lock is already held", async () => {
	const { control, deps, lock, state } = harness();
	lock.current = true;
	await runSave(deps);
	expect(control.calls()).toBe(0);
	expect(state.saving).toEqual([]);
});

it("reports a thrown save as rejected and unlocks", async () => {
	const { control, deps, errors, lock, state } = harness();
	const running = runSave(deps);
	control.fail(new Error("offline"));
	await running;
	expect(errors).toEqual([{ context: "place-save", message: "offline" }]);
	expect(state.errorShown).toEqual([null, "placeSetup.save.rejected"]);
	expect(lock.current).toBe(false);
	expect(state.saving).toEqual([true, false]);
});

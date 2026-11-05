import { describe, expect, it } from "bun:test";

import {
	type CrashSink,
	configureCrashReporting,
	reportError,
	toError,
} from "./crash-reporting";

const noopSink: CrashSink = {
	recordError() {
		// 기록하지 않는다.
	},
	setAttribute() {
		// 기록하지 않는다.
	},
	setCollectionEnabled() {
		// 기록하지 않는다.
	},
};

describe("crash reporting", () => {
	it("turns any thrown value into an Error", () => {
		expect(toError("boom").message).toBe("boom");
		expect(toError({ code: 1 }).message).toBe('{"code":1}');
		const e = new Error("x");
		expect(toError(e)).toBe(e);
	});

	it("disables collection in dev builds", () => {
		const calls: boolean[] = [];
		configureCrashReporting(
			{ ...noopSink, setCollectionEnabled: (v) => calls.push(v) },
			{ isDev: true }
		);
		expect(calls).toEqual([false]);
	});

	it("enables collection in release builds", () => {
		const calls: boolean[] = [];
		configureCrashReporting(
			{ ...noopSink, setCollectionEnabled: (v) => calls.push(v) },
			{ isDev: false }
		);
		expect(calls).toEqual([true]);
	});

	it("records errors with context", () => {
		const recorded: [string, string | undefined][] = [];
		reportError(
			{ ...noopSink, recordError: (e, c) => recorded.push([e.message, c]) },
			"nope",
			"install-identity"
		);
		expect(recorded).toEqual([["nope", "install-identity"]]);
	});

	it("never throws when the sink itself fails", () => {
		const failing: CrashSink = {
			...noopSink,
			recordError() {
				throw new Error("sink down");
			},
		};
		expect(() =>
			reportError(failing, "nope", "install-identity")
		).not.toThrow();
	});
});

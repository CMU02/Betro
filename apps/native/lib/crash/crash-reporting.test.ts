import { describe, expect, it } from "bun:test";

import {
	type CrashReportingConfig,
	type CrashSink,
	configureCrashReporting,
	reportError,
	resolveCrashReportingConfig,
	toError,
} from "./crash-reporting";

const DSN = "https://public@o0.ingest.us.sentry.io/0";

const noopSink: CrashSink = {
	recordError() {
		// 기록하지 않는다.
	},
	setInstallId() {
		// 기록하지 않는다.
	},
	start() {
		// 시작하지 않는다.
	},
};

function recordStarts(): {
	sink: CrashSink;
	starts: CrashReportingConfig[];
} {
	const starts: CrashReportingConfig[] = [];
	return {
		sink: { ...noopSink, start: (config) => starts.push(config) },
		starts,
	};
}

describe("crash reporting", () => {
	it("turns any thrown value into an Error", () => {
		expect(toError("boom").message).toBe("boom");
		expect(toError({ code: 1 }).message).toBe('{"code":1}');
		const e = new Error("x");
		expect(toError(e)).toBe(e);
	});

	it("collects in dev builds under the development environment", () => {
		const { sink, starts } = recordStarts();
		expect(configureCrashReporting(sink, { dsn: DSN, isDev: true })).toBe(true);
		expect(starts).toEqual([{ dsn: DSN, environment: "development" }]);
	});

	it("collects in release builds under the production environment", () => {
		const { sink, starts } = recordStarts();
		expect(configureCrashReporting(sink, { dsn: DSN, isDev: false })).toBe(
			true
		);
		expect(starts).toEqual([{ dsn: DSN, environment: "production" }]);
	});

	it("does not start without a DSN", () => {
		const { sink, starts } = recordStarts();
		expect(
			configureCrashReporting(sink, { dsn: undefined, isDev: false })
		).toBe(false);
		expect(configureCrashReporting(sink, { dsn: "  ", isDev: true })).toBe(
			false
		);
		expect(starts).toEqual([]);
		expect(resolveCrashReportingConfig({ dsn: "", isDev: false })).toBeNull();
	});

	it("trims the DSN", () => {
		expect(
			resolveCrashReportingConfig({ dsn: ` ${DSN}\n`, isDev: false })
		).toEqual({ dsn: DSN, environment: "production" });
	});

	it("never throws when starting the sink fails", () => {
		const failing: CrashSink = {
			...noopSink,
			start() {
				throw new Error("sdk down");
			},
		};
		expect(configureCrashReporting(failing, { dsn: DSN, isDev: false })).toBe(
			false
		);
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

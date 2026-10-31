import { describe, expect, it } from "bun:test";
import {
	freshnessOf,
	REPORT_TOP_N,
	renderTimetableReport,
	STALE_SOURCE_DAYS,
} from "./report";
import type { TimetableIssue } from "./validate";

const NOW = new Date("2026-10-31T00:00:00Z");

const issue = (
	severity: TimetableIssue["severity"],
	trainNo: string
): TimetableIssue => ({
	code: severity === "error" ? "non-monotonic" : "segment-outlier",
	detail: "",
	lineKey: "line2",
	serviceDay: "weekday",
	severity,
	trainNo,
});

describe("freshnessOf", () => {
	it("marks sources older than the stale limit and unknown dates", () => {
		expect(
			freshnessOf(
				{
					"kric-packed/sillim": "2026-05-03",
					"kric-packed/ui-sinseol": "unknown",
					"seoul-metro-csv/line2": "2026-09-14",
				},
				NOW
			)
		).toEqual([
			{
				ageDays: STALE_SOURCE_DAYS + 1,
				key: "kric-packed/sillim",
				stale: true,
				version: "2026-05-03",
			},
			{ key: "kric-packed/ui-sinseol", stale: true, version: "unknown" },
			{
				ageDays: 47,
				key: "seoul-metro-csv/line2",
				stale: false,
				version: "2026-09-14",
			},
		]);
	});
});

describe("renderTimetableReport", () => {
	it("counts issues by code and keeps the top errors first", () => {
		const issues = [
			...Array.from({ length: REPORT_TOP_N }, (_, i) => issue("warn", `W${i}`)),
			issue("error", "E1"),
		];
		const { summary, markdown } = renderTimetableReport({
			dryRun: true,
			issues,
			lines: [],
			linesWithoutTimetable: ["gtx-a"],
			manifest: {},
			now: NOW,
			ok: false,
			sourceErrors: [],
			sourceVersions: {},
			unresolvedStations: [],
		});
		expect(summary.issueCounts).toEqual({
			"non-monotonic": { error: 1, warn: 0 },
			"segment-outlier": { error: 0, warn: REPORT_TOP_N },
		});
		const top = summary.topIssues as TimetableIssue[];
		expect(top.length).toBe(REPORT_TOP_N);
		expect(top[0]?.trainNo).toBe("E1");
		expect(markdown).toContain("- gtx-a");
	});
});

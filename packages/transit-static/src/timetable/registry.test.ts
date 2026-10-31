import { describe, expect, it } from "bun:test";
import { LINES } from "../lines";
import timetableSourcesJson from "../manual/timetable-sources.json" with {
	type: "json",
};
import {
	parseTimetableSourcesConfig,
	type ResolvedLineSources,
	resolveSources,
} from "./registry";

const KORAIL_LINES = [
	"gyeongui-jungang",
	"suin-bundang",
	"gyeongchun",
	"seohae",
	"gyeonggang",
] as const;

const config = parseTimetableSourcesConfig(timetableSourcesJson);

function entryFor(
	resolved: ResolvedLineSources[],
	lineKey: string
): ResolvedLineSources {
	const entry = resolved.find((r) => r.lineKey === lineKey);
	if (!entry) {
		throw new Error(`no entry for ${lineKey}`);
	}
	return entry;
}

describe("timetable-sources.json", () => {
	it("names a primary source for every one of the 19 lines", () => {
		expect(Object.keys(config.lines).sort()).toEqual(
			LINES.map((line) => line.lineKey).sort()
		);
		expect(config.lines.line2.primary).toBe("seoul-metro-csv");
		expect(config.lines.shinbundang.primary).toBe("kric-packed");
		expect(config.lines["gtx-a"].primary).toBe("kric-api");
	});
	it("rejects an unknown source kind", () => {
		expect(() =>
			parseTimetableSourcesConfig({
				lines: { ...config.lines, line1: { primary: "gtfs" } },
			})
		).toThrow();
	});
	it("rejects a config that leaves a line out", () => {
		const { line1: _dropped, ...rest } = config.lines;
		expect(() => parseTimetableSourcesConfig({ lines: rest })).toThrow();
	});
});

describe("resolveSources", () => {
	it("falls back to kric-korail for Korail lines without a manual file", () => {
		const resolved = resolveSources(config, {
			hasKricKey: false,
			manualFiles: [],
		});
		for (const lineKey of KORAIL_LINES) {
			const entry = entryFor(resolved, lineKey);
			expect(entry.sources).toEqual(["kric-korail"]);
			expect(entry.missing.length).toBe(1);
		}
	});
	it("uses the Korail XLSX when its manual file is present", () => {
		const manualFile = config.lines["gyeongui-jungang"].manualFile ?? "";
		const resolved = resolveSources(config, {
			hasKricKey: false,
			manualFiles: [manualFile],
		});
		expect(entryFor(resolved, "gyeongui-jungang")).toEqual({
			lineKey: "gyeongui-jungang",
			missing: [],
			sources: ["korail-xlsx"],
		});
		expect(entryFor(resolved, "seohae").sources).toEqual(["kric-korail"]);
	});
	it("marks gtx-a missing without a KRIC key and resolves it with one", () => {
		const without = entryFor(
			resolveSources(config, { hasKricKey: false, manualFiles: [] }),
			"gtx-a"
		);
		expect(without.sources).toEqual([]);
		expect(without.missing).toEqual([
			expect.stringContaining("KRIC_SERVICE_KEY"),
		]);
		const withKey = entryFor(
			resolveSources(config, { hasKricKey: true, manualFiles: [] }),
			"gtx-a"
		);
		expect(withKey).toEqual({
			lineKey: "gtx-a",
			missing: [],
			sources: ["kric-api"],
		});
	});
	it("adds the airport express CSV on top of the KRIC file trips", () => {
		const manualFile = config.lines.airport.manualFile ?? "";
		const without = entryFor(
			resolveSources(config, { hasKricKey: false, manualFiles: [] }),
			"airport"
		);
		expect(without.sources).toEqual(["kric-packed"]);
		expect(without.missing).toEqual([
			expect.stringContaining("airport-express-csv"),
		]);
		const withFile = entryFor(
			resolveSources(config, { hasKricKey: false, manualFiles: [manualFile] }),
			"airport"
		);
		expect(withFile.sources).toEqual(["kric-packed", "airport-express-csv"]);
		expect(withFile.missing).toEqual([]);
	});
	it("returns one entry per line in LINES order", () => {
		const resolved = resolveSources(config, {
			hasKricKey: false,
			manualFiles: [],
		});
		expect(resolved.map((r) => r.lineKey)).toEqual(
			LINES.map((line) => line.lineKey)
		);
		expect(entryFor(resolved, "line1")).toEqual({
			lineKey: "line1",
			missing: [],
			sources: ["seoul-metro-csv"],
		});
	});
});

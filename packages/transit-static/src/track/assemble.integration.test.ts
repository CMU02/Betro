import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { loadBuildTracksInput } from "../jobs/build-tracks";
import { resolveDataDir } from "../paths";
import { assembleTracks } from "./assemble";

const dataDir = resolveDataDir(process.env);
const ready =
	existsSync(`${dataDir}/raw/osm/routes.json`) && existsSync("local.db");

describe.skipIf(!ready)("tracks against real OSM and crosswalk", () => {
	it("covers every crosswalk station on all 19 lines without errors", async () => {
		const r = assembleTracks(await loadBuildTracksInput(dataDir));
		expect(r.stitchFailures).toEqual([]);
		expect(r.uncoveredStations).toEqual([]);
		expect(
			r.issues.flatMap((i) => i.issues).filter((i) => i.level === "error")
		).toEqual([]);
		expect(new Set(r.shapes.map((s) => s.lineKey)).size).toBe(19);
	});
});

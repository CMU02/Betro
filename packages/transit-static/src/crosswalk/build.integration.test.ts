import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { loadBuildCrosswalkInput } from "../jobs/build-crosswalk";
import { resolveDataDir } from "../paths";
import { buildCrosswalk } from "./build";

const dataDir = resolveDataDir(process.env);
const hasRaw =
	existsSync(`${dataDir}/raw/oa-21232-station-master/station-master.json`) &&
	existsSync(`${dataDir}/raw/oa-12764-station-xlsx`);

describe.skipIf(!hasRaw)("crosswalk against real raw files", () => {
	it("matches every station on all 19 lines", async () => {
		const input = await loadBuildCrosswalkInput(dataDir);
		const r = buildCrosswalk(input);
		expect(r.unmatched).toEqual([]);
		expect(r.unmappedRoutes).toEqual([]);
		expect(r.unmappedLineNums).toEqual([]);
		expect(new Set(r.rows.map((x) => x.lineKey)).size).toBe(19);
		expect(r.rows.length).toBe(input.stations.length);
	});
});

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { loadBuildTracksInput } from "../jobs/build-tracks";
import {
	databaseFilePath,
	rawPath,
	resolveDatabaseUrl,
	resolveDataDir,
} from "../paths";
import { assembleTracks } from "./assemble";

const dataDir = resolveDataDir(process.env);
// loadBuildTracksInput이 여는 DB와 같은 위치를 본다(cwd와 무관). 원격 DB URL이면 파일 검사 없이 실행한다.
const dbFile = databaseFilePath(resolveDatabaseUrl(process.env));
const dbReady = dbFile === undefined || existsSync(dbFile);
const ready = existsSync(rawPath(dataDir, "osm", "routes.json")) && dbReady;

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

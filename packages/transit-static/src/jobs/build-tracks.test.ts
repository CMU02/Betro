import { createTestDb } from "@Betro/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rawPath } from "../paths";
import { loadBuildTracksInput } from "./build-tracks";

const RUN_FETCH_OSM = /bun transit fetch:osm/;
const RUN_BUILD_CROSSWALK = /bun transit build:crosswalk/;

describe("loadBuildTracksInput", () => {
	let dataDir = "";
	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "betro-tracks-"));
	});
	afterEach(async () => {
		await rm(dataDir, { force: true, recursive: true });
	});

	it("asks to fetch OSM routes first when there are none", async () => {
		const db = await createTestDb();
		await expect(loadBuildTracksInput(dataDir, db)).rejects.toThrow(
			RUN_FETCH_OSM
		);
	});
	it("asks to build the crosswalk first when there is no current batch", async () => {
		const path = rawPath(dataDir, "osm", "routes.json");
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify({ elements: [] }));
		const db = await createTestDb();
		await expect(loadBuildTracksInput(dataDir, db)).rejects.toThrow(
			RUN_BUILD_CROSSWALK
		);
	});
});

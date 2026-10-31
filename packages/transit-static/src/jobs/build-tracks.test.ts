import { createTestDb } from "@Betro/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isCurrentManifest, loadTracks } from "../db/load";
import { rawPath } from "../paths";
import { TRACK_PLACEMENT_VERSION } from "../track/place";
import { loadBuildTracksInput, summaryOf, trackManifest } from "./build-tracks";

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

describe("summaryOf", () => {
	it("lists anchor counts per shape and the rejected stop anchors", () => {
		const rejected = {
			code: "stop-anchor-rejected",
			detail: "S1 node 9 3000m from master",
			level: "warn",
		} as const;
		const summary = summaryOf(
			{
				issues: [{ issues: [rejected], lineKey: "line2", osmRelationId: 1 }],
				linesWithoutShape: [],
				markdown: "",
				ok: true,
				shapes: [
					{
						attribution: "",
						branchKey: "main",
						coords: [],
						direction: "up",
						lengthM: 1,
						lineKey: "line2",
						osmRelationId: 1,
						stations: [
							{
								anchor: "osm-stop",
								distanceM: 0,
								offsetM: 0,
								seq: 0,
								statnId: "S0",
							},
							{
								anchor: "station-master",
								distanceM: 1,
								offsetM: 0,
								seq: 1,
								statnId: "S1",
							},
						],
					},
				],
				stitchFailures: [],
				uncoveredStations: [],
			},
			{},
			true
		);
		expect(summary.shapes).toEqual([
			expect.objectContaining({
				anchors: {
					"osm-stop": 1,
					"osm-stop-projected": 0,
					"station-master": 1,
				},
				stations: 2,
			}),
		]);
		expect(summary.stopAnchorRejected).toEqual([
			{ detail: rejected.detail, lineKey: "line2", osmRelationId: 1 },
		]);
	});
});

describe("trackManifest", () => {
	const sources = {
		osmRoutes: { fileName: "osm/routes.json", sha256: "abc" },
	};
	it("reloads when only the placement version differs", async () => {
		const db = await createTestDb();
		await loadTracks(
			db,
			[],
			trackManifest(sources, TRACK_PLACEMENT_VERSION - 1)
		);
		expect(await isCurrentManifest(db, "track", trackManifest(sources))).toBe(
			false
		);
	});
	it("skips when the placement version and sources are the same", async () => {
		const db = await createTestDb();
		await loadTracks(db, [], trackManifest(sources));
		expect(await isCurrentManifest(db, "track", trackManifest(sources))).toBe(
			true
		);
		expect(trackManifest(sources).placementVersion).toBeDefined();
	});
});

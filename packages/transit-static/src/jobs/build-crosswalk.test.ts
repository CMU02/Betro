import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rawPath } from "../paths";
import { loadBuildCrosswalkInput } from "./build-crosswalk";

const RUN_XLSX = /bun transit fetch:station-xlsx/;
const RUN_MASTER = /bun transit fetch:station-master/;
const RUN_SEARCH = /bun transit fetch:station-search/;

async function touch(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "");
}

describe("loadBuildCrosswalkInput", () => {
	let dataDir = "";
	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "betro-crosswalk-"));
	});
	afterEach(async () => {
		await rm(dataDir, { force: true, recursive: true });
	});

	it("asks to fetch the xlsx first when there is none", async () => {
		await expect(loadBuildCrosswalkInput(dataDir)).rejects.toThrow(RUN_XLSX);
	});
	it("asks to fetch the station master when it is missing", async () => {
		await touch(
			rawPath(dataDir, "oa-12764-station-xlsx", "stations-seq57.xlsx")
		);
		await expect(loadBuildCrosswalkInput(dataDir)).rejects.toThrow(RUN_MASTER);
	});
	it("asks to fetch station search results when they are missing", async () => {
		await touch(
			rawPath(dataDir, "oa-12764-station-xlsx", "stations-seq57.xlsx")
		);
		await touch(
			rawPath(dataDir, "oa-21232-station-master", "station-master.json")
		);
		await expect(loadBuildCrosswalkInput(dataDir)).rejects.toThrow(RUN_SEARCH);
	});
});

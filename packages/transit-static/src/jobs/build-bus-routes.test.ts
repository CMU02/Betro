import { referenceBatch } from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rawPath } from "../paths";
import { buildBusRoutes, busRouteManifest } from "./build-bus-routes";

const ROUTE = { routeId: "100100290", routeName: "6411", stopCount: 117 };

function fixture(name: string): Promise<string> {
	return readFile(
		new URL(`../sources/__fixtures__/${name}`, import.meta.url),
		"utf8"
	);
}

async function putRaw(dataDir: string, source: string, body: string) {
	const path = rawPath(dataDir, source, `${ROUTE.routeId}.json`);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, body);
	return path;
}

describe("busRouteManifest", () => {
	const xlsx = { fileName: "routes-seq58.xlsx", sha256: "aa" };
	it("changes when any route raw changes", () => {
		const base = [
			{ pathSha: "p1", routeId: "1", stationsSha: "s1" },
			{ pathSha: "p2", routeId: "2", stationsSha: "s2" },
		];
		const changed = [base[0], { ...base[1], pathSha: "p3" }];
		expect(busRouteManifest(xlsx, base).routeRaw).not.toEqual(
			busRouteManifest(xlsx, changed as typeof base).routeRaw
		);
	});
	it("ignores input order", () => {
		const a = { pathSha: "p1", routeId: "1", stationsSha: "s1" };
		const b = { pathSha: "p2", routeId: "2", stationsSha: "s2" };
		expect(busRouteManifest(xlsx, [a, b])).toEqual(
			busRouteManifest(xlsx, [b, a])
		);
	});
});

describe("buildBusRoutes", () => {
	let dataDir = "";
	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "betro-bus-"));
		await putRaw(
			dataDir,
			"bus-route-stations",
			await fixture("bus-stations-6411.json")
		);
		await putRaw(
			dataDir,
			"bus-route-path",
			await fixture("bus-path-6411.json")
		);
	});
	afterEach(async () => {
		await rm(dataDir, { force: true, recursive: true });
	});

	it("skips reload for the same manifest", async () => {
		const db = await createTestDb();
		const first = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [ROUTE],
		});
		expect(first.ok).toBe(true);
		expect(first.batchId).toBeDefined();
		const second = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [ROUTE],
		});
		expect(second.batchId).toBeUndefined();
		expect(await readFile(first.mdPath, "utf8")).toContain("6411");
		expect(await readFile(second.jsonPath, "utf8")).toContain("ok");
	});

	it("does not load when ok is false", async () => {
		await rm(rawPath(dataDir, "bus-route-path", `${ROUTE.routeId}.json`));
		const db = await createTestDb();
		const result = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [ROUTE],
		});
		expect(result.ok).toBe(false);
		expect(result.batchId).toBeUndefined();
		expect(await db.select().from(referenceBatch)).toHaveLength(0);
	});

	it("does not load on dry-run", async () => {
		const db = await createTestDb();
		const result = await buildBusRoutes({
			dataDir,
			db,
			dryRun: true,
			routes: [ROUTE],
		});
		expect(result.ok).toBe(true);
		expect(result.batchId).toBeUndefined();
		expect(await db.select().from(referenceBatch)).toHaveLength(0);
	});
});

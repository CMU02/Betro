import type { LibsqlDatabase } from "@Betro/db";
import {
	busRoute,
	referenceBatch,
	type SourceManifest,
	stationCrosswalk,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { publishD1 } from "./publish-d1";

const MANIFESTS: Record<number, SourceManifest> = {
	1: { xlsx: { fileName: "s57.xlsx", sha256: "a" } },
	2: { bus: { fileName: "bus-routes.json", sha256: "b" } },
	3: { osm: { fileName: "osm.json", sha256: "c" } },
	4: { csv: { fileName: "tt.csv", sha256: "d" } },
};

/** 현재 배치 4종(1 대응표, 2 버스, 3 선로, 4 시간표)과 내려간 이전 버스 배치 5. */
async function seedLocal(): Promise<LibsqlDatabase> {
	const db = await createTestDb();
	await db.insert(referenceBatch).values([
		{
			id: 1,
			isCurrent: true,
			kind: "station_crosswalk",
			sourceManifest: MANIFESTS[1] ?? {},
		},
		{
			id: 2,
			isCurrent: true,
			kind: "bus_route",
			sourceManifest: MANIFESTS[2] ?? {},
		},
		{
			id: 3,
			isCurrent: true,
			kind: "track",
			sourceManifest: MANIFESTS[3] ?? {},
		},
		{
			id: 4,
			isCurrent: true,
			kind: "timetable",
			sourceManifest: MANIFESTS[4] ?? {},
		},
		{ id: 5, isCurrent: false, kind: "bus_route", sourceManifest: {} },
	]);
	await db.insert(stationCrosswalk).values({
		batchId: 1,
		coordSource: "station-master",
		lat: 37.5,
		lineKey: "line2",
		lng: 127,
		matchMethod: "auto-same-line",
		nameAliases: [],
		nameCanonical: "강남",
		qualityFlags: [],
		statnId: "1002000222",
		subwayId: "1002",
	});
	await db.insert(busRoute).values({
		batchId: 2,
		qualityFlags: [],
		region: "seoul",
		routeId: "100100290",
		routeName: "6411",
		routeType: "3",
		shortName: "6411",
	});
	return db;
}

interface D1Row {
	id: number;
	kind: string;
	source_manifest: string;
}

/** 가짜 wrangler. --command에는 D1의 reference_batch 행을, --file에는 빈 출력을 돌려준다. */
function fakeRun(d1Rows: D1Row[]) {
	const calls: string[][] = [];
	const run = (args: string[]): Promise<string> => {
		calls.push(args);
		if (args.includes("--command")) {
			return Promise.resolve(
				JSON.stringify([{ meta: {}, results: d1Rows, success: true }])
			);
		}
		return Promise.resolve("");
	};
	return { calls, run };
}

const fileCalls = (calls: string[][]) =>
	calls.filter((args) => args.includes("--file"));

const tempDirs: string[] = [];

async function makeOutDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "publish-d1-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
	);
});

describe("publishD1", () => {
	it("publishes every current batch to an empty D1", async () => {
		const db = await seedLocal();
		const { calls, run } = fakeRun([]);
		const outDir = await makeOutDir();
		const result = await publishD1({
			db,
			dryRun: false,
			outDir,
			run,
			target: "local",
		});
		expect(result.published).toEqual([1, 2, 3, 4]);
		expect(result.skipped).toEqual([]);
		expect(calls[0]).toEqual([
			"d1",
			"execute",
			"betro",
			"--local",
			"--json",
			"--command",
			"select id, kind, source_manifest from reference_batch",
		]);
		expect(fileCalls(calls)).toEqual([
			[
				"d1",
				"execute",
				"betro",
				"--local",
				"--yes",
				"--file",
				result.sqlPath ?? "",
			],
		]);

		// 만든 SQL을 빈 DB(마이그레이션만 적용한 D1 대역)에 실행하면 현재 배치 4개가 그대로 생긴다.
		const sql = await readFile(result.sqlPath ?? "", "utf8");
		const d1 = await createTestDb();
		await d1.$client.executeMultiple(sql);
		const batches = await d1.select().from(referenceBatch);
		expect(batches.map((batch) => [batch.id, batch.isCurrent])).toEqual([
			[1, true],
			[2, true],
			[3, true],
			[4, true],
		]);
		expect(await d1.select().from(busRoute)).toEqual(
			await db.select().from(busRoute)
		);
	});

	it("skips batches already in D1", async () => {
		const db = await seedLocal();
		const { calls, run } = fakeRun([
			{
				id: 2,
				kind: "bus_route",
				source_manifest: JSON.stringify(MANIFESTS[2]),
			},
		]);
		const outDir = await makeOutDir();
		const result = await publishD1({
			db,
			dryRun: false,
			outDir,
			run,
			target: "remote",
		});
		expect(result.skipped).toEqual([2]);
		expect(result.published).toEqual([1, 3, 4]);
		expect(calls[0]).toContain("--remote");
		expect(fileCalls(calls)).toHaveLength(1);

		const sql = await readFile(result.sqlPath ?? "", "utf8");
		expect(sql).not.toContain('INSERT INTO "bus_route"');
		expect(sql).toContain(
			`UPDATE "reference_batch" SET "is_current" = ("id" = 2) WHERE "kind" = 'bus_route';`
		);

		// D1에 이미 배치 2와 그 노선이 있는 상태에서 실행해도 id가 겹치지 않는다.
		const d1 = await createTestDb();
		await d1.insert(referenceBatch).values({
			id: 2,
			isCurrent: false,
			kind: "bus_route",
			sourceManifest: MANIFESTS[2] ?? {},
		});
		await d1.$client.executeMultiple(sql);
		const batches = await d1.select().from(referenceBatch);
		expect(
			batches.filter((batch) => batch.isCurrent).map((batch) => batch.id)
		).toEqual([1, 2, 3, 4]);
	});

	it("refuses a conflicting batch id", async () => {
		const db = await seedLocal();
		const { calls, run } = fakeRun([
			{
				id: 2,
				kind: "bus_route",
				source_manifest: JSON.stringify({
					bus: { fileName: "bus-routes.json", sha256: "other" },
				}),
			},
		]);
		const outDir = await makeOutDir();
		await expect(
			publishD1({ db, dryRun: false, outDir, run, target: "local" })
		).rejects.toThrow("reference_batch 2");
		expect(fileCalls(calls)).toEqual([]);
	});

	it("refuses a batch id that D1 holds for another kind", async () => {
		const db = await seedLocal();
		const { calls, run } = fakeRun([
			{
				id: 3,
				kind: "timetable",
				source_manifest: JSON.stringify(MANIFESTS[3]),
			},
		]);
		const outDir = await makeOutDir();
		await expect(
			publishD1({ db, dryRun: false, outDir, run, target: "local" })
		).rejects.toThrow("reference_batch 3");
		expect(fileCalls(calls)).toEqual([]);
	});

	it("dry run writes sql but does not execute", async () => {
		const db = await seedLocal();
		const { calls, run } = fakeRun([]);
		const outDir = await makeOutDir();
		const result = await publishD1({
			db,
			dryRun: true,
			outDir,
			run,
			target: "local",
		});
		expect(fileCalls(calls)).toEqual([]);
		expect(result.sqlPath).toBeDefined();
		expect(result.sqlPath?.startsWith(outDir)).toBe(true);
		expect(existsSync(result.sqlPath ?? "")).toBe(true);
		expect(result.published).toEqual([1, 2, 3, 4]);
	});

	it("requires one current batch of every kind", async () => {
		const db = await seedLocal();
		await db.delete(referenceBatch).where(eq(referenceBatch.id, 4));
		const { run } = fakeRun([]);
		const outDir = await makeOutDir();
		await expect(
			publishD1({ db, dryRun: true, outDir, run, target: "local" })
		).rejects.toThrow("current timetable batch");
	});
});

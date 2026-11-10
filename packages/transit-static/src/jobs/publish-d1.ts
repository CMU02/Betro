import type { LibsqlDatabase } from "@Betro/db";
import {
	type ReferenceBatchKind,
	referenceBatch,
	type SourceManifest,
} from "@Betro/db/schema/transit";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
	currentFlipSql,
	D1_PUBLISH_KINDS,
	exportBatchSql,
} from "../db/export-sql";

/** wrangler.jsonc의 D1 database_name */
export const D1_DATABASE_NAME = "betro";
/** transit-static 패키지 폴더 기준 wrangler 설정 경로 */
export const WRANGLER_CONFIG_PATH = "../../apps/server/wrangler.jsonc";

const PACKAGE_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	".."
);
const WRANGLER_BIN = resolve(
	PACKAGE_DIR,
	"..",
	"..",
	"apps",
	"server",
	"node_modules",
	".bin",
	"wrangler"
);

const BATCH_QUERY = "select id, kind, source_manifest from reference_batch";

export type D1Target = "local" | "remote";

/** wrangler 인자(앞의 "wrangler" 제외)를 받아 실행하고 stdout을 돌려준다. */
export type WranglerRun = (args: string[]) => Promise<string>;

export interface PublishD1Options {
	db: LibsqlDatabase;
	dryRun: boolean;
	outDir: string;
	run: WranglerRun;
	target: D1Target;
}

export interface PublishD1Result {
	published: number[];
	skipped: number[];
	sqlPath?: string;
}

const d1QueryOutputSchema = z.array(
	z.object({
		results: z.array(
			z.object({
				id: z.number().int(),
				kind: z.string(),
				source_manifest: z.string(),
			})
		),
	})
);

const sourceManifestSchema = z.record(
	z.string(),
	z.object({ fileName: z.string(), sha256: z.string() })
);

interface RemoteBatch {
	id: number;
	kind: string;
	manifest: SourceManifest;
}

function parseJsonOutput(output: string): unknown {
	try {
		return JSON.parse(output);
	} catch (error) {
		// wrangler가 JSON 앞뒤에 다른 줄을 찍은 경우 배열 부분만 읽는다.
		const start = output.indexOf("[");
		const end = output.lastIndexOf("]");
		if (start < 0 || end <= start) {
			throw new Error("wrangler d1 execute --json returned no JSON array", {
				cause: error,
			});
		}
		return JSON.parse(output.slice(start, end + 1));
	}
}

/** `wrangler d1 execute --json --command` 출력에서 reference_batch 행을 읽는다. */
export function parseRemoteBatches(output: string): RemoteBatch[] {
	const parsed = d1QueryOutputSchema.parse(parseJsonOutput(output));
	return parsed.flatMap((result) =>
		result.results.map((row) => ({
			id: row.id,
			kind: row.kind,
			manifest: sourceManifestSchema.parse(JSON.parse(row.source_manifest)),
		}))
	);
}

function sameManifest(a: SourceManifest, b: SourceManifest): boolean {
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) {
		return false;
	}
	return keys.every((key) => {
		const left = a[key];
		const right = b[key];
		return (
			left !== undefined &&
			right !== undefined &&
			left.fileName === right.fileName &&
			left.sha256 === right.sha256
		);
	});
}

interface LocalCurrentBatches {
	batches: { id: number; kind: ReferenceBatchKind; manifest: SourceManifest }[];
	currentIds: Record<ReferenceBatchKind, number>;
}

/** local.db의 현재 배치. 종류마다 정확히 하나여야 한다. */
async function loadLocalCurrentBatches(
	db: LibsqlDatabase
): Promise<LocalCurrentBatches> {
	const rows = await db
		.select({
			id: referenceBatch.id,
			kind: referenceBatch.kind,
			manifest: referenceBatch.sourceManifest,
		})
		.from(referenceBatch)
		.where(eq(referenceBatch.isCurrent, true));
	const currentId = (kind: ReferenceBatchKind): number => {
		const matches = rows.filter((row) => row.kind === kind);
		const [only] = matches;
		if (!only || matches.length > 1) {
			throw new Error(
				`local db must have exactly one current ${kind} batch (found ${matches.length})`
			);
		}
		return only.id;
	};
	const currentIds: Record<ReferenceBatchKind, number> = {
		bus_route: currentId("bus_route"),
		station_crosswalk: currentId("station_crosswalk"),
		timetable: currentId("timetable"),
		track: currentId("track"),
	};
	const batches = rows
		.filter((row) => D1_PUBLISH_KINDS.includes(row.kind))
		.sort((a, b) => a.id - b.id);
	return { batches, currentIds };
}

const sqlFileName = (now: Date): string =>
	`${now.toISOString().replaceAll(":", "-")}.sql`;

/**
 * local.db의 현재 배치를 D1에 올린다.
 * ① D1의 reference_batch를 읽고 ② D1에 같은 id가 없는 현재 배치만 내보낸다(같은 id인데 manifest가 다르면 멈춤).
 * ③ INSERT와 현재 배치 표시를 SQL 파일로 쓰고 ④ dryRun이 아니면 wrangler로 실행한다.
 */
export async function publishD1(
	options: PublishD1Options
): Promise<PublishD1Result> {
	const { db, dryRun, outDir, run, target } = options;
	const remote = parseRemoteBatches(
		await run([
			"d1",
			"execute",
			D1_DATABASE_NAME,
			`--${target}`,
			"--json",
			"--command",
			BATCH_QUERY,
		])
	);
	const remoteById = new Map(remote.map((batch) => [batch.id, batch]));
	const { batches: local, currentIds } = await loadLocalCurrentBatches(db);

	const published: number[] = [];
	const skipped: number[] = [];
	for (const batch of local) {
		const existing = remoteById.get(batch.id);
		if (!existing) {
			published.push(batch.id);
			continue;
		}
		if (
			existing.kind !== batch.kind ||
			!sameManifest(existing.manifest, batch.manifest)
		) {
			throw new Error(
				`D1 reference_batch ${batch.id} (${existing.kind}) differs from local ${batch.kind} batch ${batch.id}; refusing to publish`
			);
		}
		skipped.push(batch.id);
	}

	const statements = [
		...(await exportBatchSql(db, published)),
		...currentFlipSql(currentIds),
	];
	await mkdir(outDir, { recursive: true });
	const sqlPath = join(outDir, sqlFileName(new Date()));
	await writeFile(sqlPath, `${statements.join("\n")}\n`);

	if (!dryRun) {
		await run([
			"d1",
			"execute",
			D1_DATABASE_NAME,
			`--${target}`,
			"--yes",
			"--file",
			sqlPath,
		]);
	}
	return { published, skipped, sqlPath };
}

const OUTPUT_TAIL_CHARS = 2000;

/**
 * apps/server에 설치된 wrangler를 transit-static 폴더에서 `--config ../../apps/server/wrangler.jsonc`로 실행한다.
 * stderr는 그대로 보여 주고 stdout은 모아서 돌려준다. 실패하면 stdout 끝부분을 담아 던진다.
 */
export function createWranglerRun(): WranglerRun {
	return (args) =>
		new Promise((resolvePromise, reject) => {
			const child = spawn(
				WRANGLER_BIN,
				[...args, "--config", WRANGLER_CONFIG_PATH],
				{ cwd: PACKAGE_DIR, stdio: ["ignore", "pipe", "inherit"] }
			);
			const chunks: Buffer[] = [];
			child.stdout.on("data", (chunk: Buffer) => {
				chunks.push(chunk);
			});
			child.on("error", reject);
			child.on("close", (exitCode) => {
				const stdout = Buffer.concat(chunks).toString("utf8");
				if (exitCode === 0) {
					resolvePromise(stdout);
					return;
				}
				reject(
					new Error(
						`wrangler ${args.slice(0, 2).join(" ")} failed (exit ${exitCode}): ${stdout
							.trim()
							.slice(-OUTPUT_TAIL_CHARS)}`
					)
				);
			});
		});
}

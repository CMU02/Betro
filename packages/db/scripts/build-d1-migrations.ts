import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PAD = 4;

/**
 * drizzle 마이그레이션 폴더(<폴더>/migration.sql)를 이름순으로 정렬해
 * wrangler d1 migrations 형식(0001_<폴더명>.sql)으로 복사한다.
 */
export async function buildD1Migrations(
	srcDir: string,
	outDir: string
): Promise<string[]> {
	const entries = await readdir(srcDir, { withFileTypes: true });
	const folders = entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();

	await rm(outDir, { force: true, recursive: true });
	await mkdir(outDir, { recursive: true });

	const names = folders.map(
		(folder, i) => `${String(i + 1).padStart(PAD, "0")}_${folder}.sql`
	);
	await Promise.all(
		folders.map(async (folder, i) => {
			const sql = await readFile(join(srcDir, folder, "migration.sql"), "utf8");
			await writeFile(join(outDir, names[i] as string), sql);
		})
	);
	return names;
}

if (import.meta.main) {
	const src = fileURLToPath(new URL("../src/migrations", import.meta.url));
	const out = fileURLToPath(new URL("../d1-migrations", import.meta.url));
	const names = await buildD1Migrations(src, out);
	console.log(`wrote ${names.length} D1 migrations to ${out}`);
}

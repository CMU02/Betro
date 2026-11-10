import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildD1Migrations } from "./build-d1-migrations";

let root: string;
let src: string;
let out: string;

const SQL_B =
	"CREATE TABLE b (id integer);\n--> statement-breakpoint\nCREATE INDEX i ON b (id);";
const SQL_A = "CREATE TABLE a (id integer);";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "d1-mig-"));
	src = join(root, "src");
	out = join(root, "out");
	await mkdir(join(src, "20261101_b"), { recursive: true });
	await mkdir(join(src, "20261031_a"), { recursive: true });
	await writeFile(join(src, "20261101_b", "migration.sql"), SQL_B);
	await writeFile(join(src, "20261031_a", "migration.sql"), SQL_A);
});

afterEach(async () => {
	await rm(root, { force: true, recursive: true });
});

test("numbers migrations in folder order", async () => {
	const names = await buildD1Migrations(src, out);
	expect(names).toEqual(["0001_20261031_a.sql", "0002_20261101_b.sql"]);
	expect(await readFile(join(out, names[0] as string), "utf8")).toBe(SQL_A);
	expect(await readFile(join(out, names[1] as string), "utf8")).toBe(SQL_B);
});

test("is idempotent", async () => {
	await mkdir(out, { recursive: true });
	await writeFile(join(out, "stale.sql"), "x");
	const first = await buildD1Migrations(src, out);
	const second = await buildD1Migrations(src, out);
	expect(second).toEqual(first);
	expect((await readdir(out)).sort()).toEqual(first);
	expect(await readFile(join(out, first[1] as string), "utf8")).toBe(SQL_B);
});

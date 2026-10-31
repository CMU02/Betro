import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { databaseFilePath, resolveDatabaseUrl } from "./paths";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

describe("databaseFilePath", () => {
	it("maps the default database URL to the repo-root local.db regardless of cwd", () => {
		expect(databaseFilePath(resolveDatabaseUrl({}))).toBe(
			join(REPO_ROOT, "local.db")
		);
	});

	it("decodes absolute file URLs", () => {
		const file = join(REPO_ROOT, "some dir", "x.db");
		expect(databaseFilePath(pathToFileURL(file).href)).toBe(file);
	});

	it("resolves relative file: URLs against cwd, dropping the query", () => {
		expect(databaseFilePath("file:./local.db?mode=ro")).toBe(
			resolve("local.db")
		);
	});

	it("returns undefined for non-file URLs", () => {
		expect(databaseFilePath(":memory:")).toBeUndefined();
		expect(databaseFilePath("libsql://example.turso.io")).toBeUndefined();
		expect(databaseFilePath("https://example.com/db")).toBeUndefined();
	});

	it("uses DATABASE_URL when set", () => {
		const file = join(REPO_ROOT, "other.db");
		expect(
			databaseFilePath(
				resolveDatabaseUrl({ DATABASE_URL: pathToFileURL(file).href })
			)
		).toBe(file);
	});
});

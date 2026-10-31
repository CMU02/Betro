import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRaw, resolveDataDir, saveRaw, sha256Hex } from "./raw-store";

const DATA_DIR_SUFFIX = /data$/;

describe("raw store", () => {
	it("resolveDataDir prefers BETRO_DATA_DIR", () => {
		expect(resolveDataDir({ BETRO_DATA_DIR: "/x" })).toBe("/x");
		expect(resolveDataDir({})).toMatch(DATA_DIR_SUFFIX);
	});
	it("saves, hashes, and skips unchanged bytes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "betro-raw-"));
		const bytes = new TextEncoder().encode("hello");
		const first = await saveRaw(dir, "test-src", "a.txt", bytes);
		expect(first.sha256).toBe(sha256Hex(bytes));
		expect(first.unchanged).toBe(false);
		const second = await saveRaw(dir, "test-src", "a.txt", bytes);
		expect(second.unchanged).toBe(true);
		const read = await readRaw(dir, "test-src", "a.txt");
		expect(read?.sha256).toBe(first.sha256);
		expect(await readRaw(dir, "test-src", "missing.txt")).toBeUndefined();
	});
});

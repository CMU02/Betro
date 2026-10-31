import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPath } from "../paths";
import { fetchKricFile } from "./kric-file";

const NOT_XLSX = /not a valid xlsx/;

describe("fetchKricFile", () => {
	it("throws and writes nothing when the body is not an xlsx", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-kric-"));
		try {
			const fetchImpl = (() =>
				Promise.resolve(
					new Response("<html>잘못된 접근</html>", { status: 200 })
				)) as unknown as typeof fetch;
			await expect(
				fetchKricFile(dataDir, "http://x", fetchImpl)
			).rejects.toThrow(NOT_XLSX);
			expect(
				existsSync(rawPath(dataDir, "kric-timetable", "kric-timetable.xlsx"))
			).toBe(false);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});

	it("saves the xlsx under the file name from Content-Disposition", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-kric-"));
		try {
			const body = new Uint8Array([0x50, 0x4b, 3, 4]);
			const fetchImpl = (() =>
				Promise.resolve(
					new Response(body, {
						headers: {
							"content-disposition":
								'attachment; filename="test_20260630.xlsx"',
						},
						status: 200,
					})
				)) as unknown as typeof fetch;
			const saved = await fetchKricFile(dataDir, "http://x", fetchImpl);
			expect(saved.fileName).toBe("test_20260630.xlsx");
			expect(
				existsSync(rawPath(dataDir, "kric-timetable", "test_20260630.xlsx"))
			).toBe(true);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});
});

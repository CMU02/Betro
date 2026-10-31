import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReport } from "./reports";

describe("writeReport", () => {
	it("writes json and markdown under reports/<job>/<timestamp>", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-report-"));
		try {
			const now = new Date(Date.UTC(2026, 9, 31, 4, 5, 6));
			const r = await writeReport(
				dataDir,
				"build-crosswalk",
				{ markdown: "# 보고서\n", summary: { ok: true } },
				now
			);
			expect(r.jsonPath).toBe(
				join(dataDir, "reports", "build-crosswalk", "20261031T040506.json")
			);
			expect(r.mdPath).toBe(
				join(dataDir, "reports", "build-crosswalk", "20261031T040506.md")
			);
			expect(JSON.parse(await readFile(r.jsonPath, "utf8"))).toEqual({
				ok: true,
			});
			expect(await readFile(r.mdPath, "utf8")).toBe("# 보고서\n");
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});
});

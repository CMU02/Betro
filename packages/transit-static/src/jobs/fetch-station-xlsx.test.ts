import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPath } from "../paths";
import { fetchStationXlsx } from "./fetch-station-xlsx";

const NOT_XLSX = /not a valid xlsx/;

const html = "<html><script>alert('잘못된 접근입니다.')</script></html>";

describe("fetchStationXlsx", () => {
	it("throws and writes nothing when the body is an HTML page", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-xlsx-"));
		try {
			const fetchImpl = (() =>
				Promise.resolve(
					new Response(html, {
						headers: { "content-type": "text/html;charset=UTF-8" },
						status: 200,
					})
				)) as unknown as typeof fetch;
			await expect(
				fetchStationXlsx({ dataDir, fetchImpl, seq: 99_999 })
			).rejects.toThrow(NOT_XLSX);
			expect(
				existsSync(
					rawPath(dataDir, "oa-12764-station-xlsx", "stations-seq99999.xlsx")
				)
			).toBe(false);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});

	it("saves a zip-signature body", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-xlsx-"));
		try {
			const fetchImpl = (() =>
				Promise.resolve(
					new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))
				)) as unknown as typeof fetch;
			const result = await fetchStationXlsx({ dataDir, fetchImpl, seq: 57 });
			expect(result.unchanged).toBe(false);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});
});

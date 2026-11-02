import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPath } from "../paths";
import { fetchBusRouteXlsx, latestBusRouteXlsx } from "./fetch-bus-route-xlsx";

const NOT_XLSX = /not a valid xlsx/;
const RUN_FETCH_FIRST = /fetch:bus-route-xlsx/;

describe("fetchBusRouteXlsx", () => {
	it("throws and writes nothing for a non-zip body", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-bus-xlsx-"));
		try {
			const fetchImpl = (() =>
				Promise.resolve(
					new Response("<html></html>", { status: 200 })
				)) as unknown as typeof fetch;
			await expect(
				fetchBusRouteXlsx({ dataDir, fetchImpl, seq: 99_999 })
			).rejects.toThrow(NOT_XLSX);
			expect(
				existsSync(
					rawPath(dataDir, "oa-1095-bus-route-xlsx", "routes-seq99999.xlsx")
				)
			).toBe(false);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});

	it("saves a zip-signature body", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-bus-xlsx-"));
		try {
			const fetchImpl = (() =>
				Promise.resolve(
					new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), {
						status: 200,
					})
				)) as unknown as typeof fetch;
			const result = await fetchBusRouteXlsx({ dataDir, fetchImpl, seq: 58 });
			expect(result.unchanged).toBe(false);
			expect(existsSync(result.path)).toBe(true);
			expect(result.path.endsWith("routes-seq58.xlsx")).toBe(true);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});
});

describe("latestBusRouteXlsx", () => {
	it("picks the largest seq and errors when none exist", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-bus-xlsx-"));
		try {
			await expect(latestBusRouteXlsx(dataDir)).rejects.toThrow(
				RUN_FETCH_FIRST
			);
			const dir = join(dataDir, "raw", "oa-1095-bus-route-xlsx");
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, "routes-seq9.xlsx"), "x");
			await writeFile(join(dir, "routes-seq58.xlsx"), "x");
			expect(await latestBusRouteXlsx(dataDir)).toEqual({
				fileName: "routes-seq58.xlsx",
				seq: 58,
			});
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});
});

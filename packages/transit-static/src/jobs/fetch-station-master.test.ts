import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchStationMaster } from "./fetch-station-master";

describe("fetchStationMaster job", () => {
	it("saves original API rows before normalization fails", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-master-"));
		const rawRow = { BLDN_ID: " 0150 ", EXTRA: "x", LAT: "bad", LOT: "127" };
		const fetchImpl = () =>
			Promise.resolve(
				Response.json({
					subwayStationMaster: {
						list_total_count: 1,
						RESULT: { CODE: "INFO-000", MESSAGE: "ok" },
						row: [rawRow],
					},
				})
			);
		await expect(
			fetchStationMaster({
				dataDir,
				fetchImpl: fetchImpl as unknown as typeof fetch,
				key: "K",
			})
		).rejects.toThrow("raw saved");
		const saved = JSON.parse(
			await readFile(
				join(dataDir, "raw", "oa-21232-station-master", "station-master.json"),
				"utf8"
			)
		);
		expect(saved).toEqual({ rows: [rawRow] });
	});
});

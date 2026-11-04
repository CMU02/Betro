import { describe, expect, it } from "bun:test";
import {
	dedupeRaw,
	HISTORY_FLUSH_BYTES,
	HISTORY_FLUSH_MS,
	HistoryBuffer,
	type RawRecord,
	sha256Hex,
} from "./history";
import { kstToEpochMs } from "./time";

async function gunzip(body: Uint8Array): Promise<string> {
	const stream = new Blob([body])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return await new Response(stream).text();
}

describe("history buffer", () => {
	it("writes hourly gzip ndjson", async () => {
		const buf = new HistoryBuffer("events", []);
		buf.add("subway", kstToEpochMs("2026-11-03 12:59:00"), { n: 1 });
		buf.add("subway", kstToEpochMs("2026-11-03 13:01:00"), { n: 2 });
		const files = await buf.flush(0, () => 0);
		expect(files.map((f) => f.key)).toEqual([
			"events/subway/2026/11/03/12-0.ndjson.gz",
			"events/subway/2026/11/03/13-0.ndjson.gz",
		]);
		const first = await gunzip(files[0]?.body as Uint8Array);
		expect(
			first
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
		).toEqual([{ n: 1 }]);
		const second = await gunzip(files[1]?.body as Uint8Array);
		expect(second.trim().split("\n")).toHaveLength(1);
		expect(buf.due(Number.MAX_SAFE_INTEGER)).toBe(false);
	});

	it("drops identical bodies", async () => {
		const hash = await sha256Hex("body");
		const record: RawRecord = {
			body: "body",
			bodyHash: hash,
			fetchedAt: 1,
			request: "u",
			source: "s",
			status: 200,
		};
		const second = dedupeRaw(hash, record);
		expect(second.body).toBeUndefined();
		expect(second.bodyHash).toBe(hash);
		expect(dedupeRaw(undefined, record).body).toBe("body");
		expect(dedupeRaw("other", record).body).toBe("body");
	});

	it("redacts keys before buffering", async () => {
		const key = "a/b+c=";
		const buf = new HistoryBuffer("raw", [key]);
		buf.add("x", kstToEpochMs("2026-11-03 12:00:00"), {
			request: `https://h/${key}/p?k=${encodeURIComponent(key)}`,
		});
		const files = await buf.flush(0, () => 3);
		expect(files[0]?.key).toBe("raw/x/2026/11/03/12-3.ndjson.gz");
		const text = await gunzip(files[0]?.body as Uint8Array);
		expect(text).not.toContain(key);
		expect(text).not.toContain(encodeURIComponent(key));
		expect(text).toContain("<key>");
	});

	it("flushes on size or time", () => {
		const t = kstToEpochMs("2026-11-03 12:00:00");
		const timed = new HistoryBuffer("events", []);
		expect(timed.due(t)).toBe(false);
		timed.add("s", t, { a: 1 });
		expect(timed.due(t + HISTORY_FLUSH_MS - 1)).toBe(false);
		expect(timed.due(t + HISTORY_FLUSH_MS)).toBe(true);

		const sized = new HistoryBuffer("raw", []);
		sized.add("s", t, { body: "x".repeat(HISTORY_FLUSH_BYTES) });
		expect(sized.due(t)).toBe(true);
	});
});

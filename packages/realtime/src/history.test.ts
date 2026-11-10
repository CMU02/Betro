import { describe, expect, it } from "bun:test";
import {
	dedupeRaw,
	HISTORY_FLUSH_BYTES,
	HISTORY_FLUSH_MS,
	HistoryBuffer,
	type RawRecord,
	sha256Hex,
	summarizeHistory,
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

	it("reports the hour file of each added line and the line count of each part", async () => {
		const added: string[] = [];
		const buf = new HistoryBuffer("raw", [], (hourKey) => {
			added.push(hourKey);
		});
		const t = kstToEpochMs("2026-11-03 12:10:00");
		buf.add("subway-all", t, { n: 1 });
		buf.add("subway-all", t + 1000, { n: 2 });
		expect(added).toEqual([
			"raw/subway-all/2026/11/03/12",
			"raw/subway-all/2026/11/03/12",
		]);
		const files = await buf.flush(0, () => 0);
		expect(files.map((f) => ({ hourKey: f.hourKey, lines: f.lines }))).toEqual([
			{ hourKey: "raw/subway-all/2026/11/03/12", lines: 2 },
		]);
	});
});

describe("history summary", () => {
	const window = {
		from: kstToEpochMs("2026-11-03 05:00:00"),
		to: kstToEpochMs("2026-11-04 01:00:00"),
	};

	it("sums buffered and written lines per source inside the window", () => {
		const summary = summarizeHistory(
			{
				"events/bus/2026/11/03/12": { buffered: 40, written: 0 },
				"events/subway/2026/11/03/12": { buffered: 300, written: 300 },
				"raw/bus-100100029/2026/11/03/12": { buffered: 23, written: 20 },
				"raw/bus-100100290/2026/11/03/12": { buffered: 22, written: 22 },
				// 운행 시간 밖(04시, 다음 날 01시)은 세지 않는다.
				"raw/subway-all/2026/11/03/04": { buffered: 9, written: 0 },
				"raw/subway-all/2026/11/03/05": { buffered: 45, written: 45 },
				"raw/subway-all/2026/11/04/00": { buffered: 45, written: 40 },
				"raw/subway-all/2026/11/04/01": { buffered: 9, written: 0 },
			},
			window
		);
		expect(summary).toEqual({
			events: {
				bus: { buffered: 40, written: 0 },
				subway: { buffered: 300, written: 300 },
			},
			raw: {
				bus: { buffered: 45, written: 42 },
				subway: { buffered: 90, written: 85 },
			},
		});
	});

	it("is null when no counted hour falls inside the window", () => {
		expect(
			summarizeHistory(
				{ "raw/subway-all/2026/11/01/12": { buffered: 1, written: 1 } },
				window
			)
		).toBeNull();
	});
});

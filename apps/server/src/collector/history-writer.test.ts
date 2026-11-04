import { describe, expect, test } from "bun:test";
import { HistoryWriter, MAX_PUTS_PER_WRITE } from "./history-writer";
import type { BlobStore } from "./ports";

const NOW = Date.UTC(2026, 10, 4, 3, 0, 0);
const HOUR_MS = 3_600_000;

const failingStore = (): BlobStore & { calls: number } => {
	const store = {
		calls: 0,
		put(): Promise<void> {
			store.calls += 1;
			return Promise.reject(new Error("r2 down"));
		},
	};
	return store;
};

const quietHooks = {
	onError: () => undefined,
	persistParts: async () => undefined,
};

describe("HistoryWriter backlog", () => {
	test("caps retried parts per write", async () => {
		const writer = new HistoryWriter([]);
		const store = failingStore();
		const parts = MAX_PUTS_PER_WRITE + 20;
		for (const i of Array.from({ length: parts }, (_, n) => n)) {
			// 시간마다 다른 파일이 되어 조각이 parts개 생긴다.
			writer.raw.add("subway-all", NOW + i * HOUR_MS, { i });
		}
		await writer.write(store, NOW, true, quietHooks);
		expect(store.calls).toBe(MAX_PUTS_PER_WRITE);
		expect(writer.pendingCount).toBe(parts);
	});

	test("drops the oldest parts when the backlog exceeds the byte limit", async () => {
		// 조각 하나(작은 gzip, 수십 바이트)보다 조금 큰 상한.
		const writer = new HistoryWriter([], {}, 200);
		const store = failingStore();
		const dropped: string[] = [];
		const hooks = {
			onError: (key: string, error: unknown) => {
				if (String(error).includes("dropped oldest")) {
					dropped.push(key);
				}
			},
			persistParts: async () => undefined,
		};
		for (const i of Array.from({ length: 10 }, (_, n) => n)) {
			writer.raw.add("subway-all", NOW + i * HOUR_MS, { i });
		}
		await writer.write(store, NOW, true, hooks);
		expect(dropped.length).toBeGreaterThan(0);
		expect(writer.pendingCount).toBe(10 - dropped.length);
		// 가장 오래된 시간(KST 12시) 조각부터 버린다.
		expect(dropped[0]).toContain("/12-0.ndjson.gz");
	});
});

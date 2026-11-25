import { DEFAULT_TIMEZONE } from "@Betro/commute/config";
import { commuteSession } from "@Betro/db/schema/commute";
import { createTestDb } from "@Betro/db/test-db";
import { beforeEach, describe, expect, it } from "bun:test";
import {
	pruneSessionBlobs,
	pruneSessionRows,
	type RecordBucket,
	recordCutoffDate,
	SESSION_RECORD_KEEP_DAYS,
} from "./record-prune";

// 2026-11-25 04:02 KST
const NOW = Date.UTC(2026, 10, 24, 19, 2, 0);

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeEach(async () => {
	db = await createTestDb();
});

function memoryBucket(keys: string[], pageSize = 2) {
	const stored = new Set(keys);
	const bucket: RecordBucket = {
		delete(toDelete) {
			for (const key of toDelete) {
				stored.delete(key);
			}
			return Promise.resolve();
		},
		list({ cursor, prefix }) {
			const all = [...stored].filter((key) => key.startsWith(prefix)).sort();
			const start = cursor === undefined ? 0 : Number(cursor);
			const page = all.slice(start, start + pageSize);
			const next = start + pageSize;
			return Promise.resolve(
				next < all.length
					? {
							cursor: String(next),
							objects: page.map((key) => ({ key })),
							truncated: true,
						}
					: { objects: page.map((key) => ({ key })), truncated: false }
			);
		},
	};
	return { bucket, stored };
}

describe("recordCutoffDate", () => {
	it("보관 기간은 90일이고 그보다 오래된 서비스일이 지울 대상이다", () => {
		expect(SESSION_RECORD_KEEP_DAYS).toBe(90);
		// 2026-11-25에서 90일 전은 2026-08-27
		expect(recordCutoffDate(NOW, DEFAULT_TIMEZONE)).toBe("2026-08-27");
	});
});

describe("pruneSessionRows", () => {
	it("기준일보다 앞선 서비스일의 세션 행만 지운다", async () => {
		const row = (id: string, serviceDate: string) => ({
			endedAt: 1,
			id,
			installId: "i1",
			planId: `p-${id}`,
			serviceDate,
			startedAt: 1,
			status: "ended" as const,
		});
		await db
			.insert(commuteSession)
			.values([
				row("old", "2026-08-26"),
				row("edge", "2026-08-27"),
				row("new", "2026-11-24"),
			]);
		expect(await pruneSessionRows(db, "2026-08-27")).toBe(1);
		const left = await db
			.select({ id: commuteSession.id })
			.from(commuteSession);
		expect(left.map((r) => r.id).sort()).toEqual(["edge", "new"]);
	});
});

describe("pruneSessionBlobs", () => {
	it("기록·요약·일일 보고 중 기준일보다 앞선 날짜의 객체만 지운다", async () => {
		const { bucket, stored } = memoryBucket([
			"commute/records/2026-08-26/a.ndjson.gz",
			"commute/records/2026-08-27/b.ndjson.gz",
			"commute/summaries/2026-08-01/a.json",
			"commute/summaries/2026-08-26/c.json",
			"commute/summaries/2026-09-01/d.json",
			"commute/reports/2026-08-26.json",
			"commute/reports/2026-11-24.json",
			"snapshots/2026-01-01/keep.json",
		]);
		expect(await pruneSessionBlobs(bucket, "2026-08-27")).toBe(4);
		expect([...stored].sort()).toEqual([
			"commute/records/2026-08-27/b.ndjson.gz",
			"commute/reports/2026-11-24.json",
			"commute/summaries/2026-09-01/d.json",
			"snapshots/2026-01-01/keep.json",
		]);
	});
});

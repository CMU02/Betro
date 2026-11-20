import { expect, it } from "bun:test";
import { createMotionMetrics, type MotionDailyReport } from "./motion-metrics";

function memoryStore(): {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	values: Map<string, string>;
} {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		values,
	};
}

/** 2026-11-20 10:00 KST */
const DAY1 = Date.UTC(2026, 10, 20, 1, 0, 0);
const HOUR_MS = 3_600_000;

it("metrics ratio = (backward + jump) / updates, reset per day", () => {
	const store = memoryStore();
	let now = DAY1;
	const reports: MotionDailyReport[] = [];
	const metrics = createMotionMetrics(
		store,
		() => now,
		(report) => {
			reports.push(report);
		}
	);
	expect(metrics.summary()).toEqual({
		backward: 0,
		jump: 0,
		ratio: 0,
		updates: 0,
	});

	for (let i = 0; i < 7; i += 1) {
		metrics.record(null);
	}
	metrics.record("jump");
	metrics.record("backward");
	metrics.record("jump");
	expect(metrics.summary()).toEqual({
		backward: 1,
		jump: 2,
		ratio: 0.3,
		updates: 10,
	});

	// kv에 쌓여 있어 앱을 다시 열어도 그날 숫자가 이어진다.
	const reopened = createMotionMetrics(store, () => now);
	expect(reopened.summary().updates).toBe(10);

	// KST 자정을 넘기면 새 날이다. 지난날 숫자를 한 번만 보낸다(위치 없이 숫자만).
	now = DAY1 + 15 * HOUR_MS;
	metrics.record(null);
	expect(metrics.summary()).toEqual({
		backward: 0,
		jump: 0,
		ratio: 0,
		updates: 1,
	});
	metrics.record(null);
	expect(reports).toEqual([
		{ backward: 1, day: "2026-11-20", jump: 2, ratio: 0.3, updates: 10 },
	]);
});

it("does not report an empty day and survives a broken store", () => {
	let now = DAY1;
	const reports: MotionDailyReport[] = [];
	const metrics = createMotionMetrics(
		{
			getItem: () => "{not json",
			setItem: () => {
				throw new Error("disk full");
			},
		},
		() => now,
		(report) => {
			reports.push(report);
		}
	);
	expect(metrics.summary().updates).toBe(0);
	now = DAY1 + 48 * HOUR_MS;
	metrics.record("backward");
	expect(metrics.summary()).toEqual({
		backward: 1,
		jump: 0,
		ratio: 1,
		updates: 1,
	});
	expect(reports).toEqual([]);
});

import { describe, expect, it } from "bun:test";

import { createPoller } from "./polling";

const FLUSH_ROUNDS = 5;

/** 대기 중인 마이크로태스크를 비운다. */
const flush = (): Promise<void> =>
	new Promise((resolve) => {
		let rounds = 0;
		const step = (): void => {
			rounds += 1;
			if (rounds >= FLUSH_ROUNDS) {
				resolve();
				return;
			}
			queueMicrotask(step);
		};
		queueMicrotask(step);
	});

/** 가짜 시계. `advance`가 예약된 작업을 시각 순서대로 실행한다. */
function fakeClock() {
	let nowMs = 0;
	let nextId = 0;
	const pending = new Map<number, { at: number; fn: () => void }>();
	/** 목표 시각까지 예약된 작업을 시각 순서대로 실행한다. 작업마다 마이크로태스크를 비운다. */
	const runUntil = async (target: number): Promise<void> => {
		const [due] = [...pending.entries()]
			.filter(([, candidate]) => candidate.at <= target)
			.sort((a, b) => a[1].at - b[1].at);
		if (due === undefined) {
			nowMs = target;
			return;
		}
		const [id, job] = due;
		pending.delete(id);
		nowMs = job.at;
		job.fn();
		await flush();
		await runUntil(target);
	};
	return {
		async advance(ms: number): Promise<void> {
			await runUntil(nowMs + ms);
		},
		now: () => nowMs,
		pendingCount: () => pending.size,
		schedule(fn: () => void, ms: number) {
			nextId += 1;
			const id = nextId;
			pending.set(id, { at: nowMs + ms, fn });
			return () => {
				pending.delete(id);
			};
		},
	};
}

function setup(intervalMs = 10_000) {
	const clock = fakeClock();
	const calls: number[] = [];
	const poller = createPoller({
		intervalMs,
		now: clock.now,
		run: () => {
			calls.push(clock.now());
			return Promise.resolve();
		},
		schedule: clock.schedule,
	});
	return { calls, clock, poller };
}

describe("createPoller", () => {
	it("runs immediately on becoming visible, then every interval", async () => {
		const { calls, clock, poller } = setup();
		poller.setVisible(true);
		await flush();
		expect(calls).toEqual([0]);
		await clock.advance(10_000);
		await clock.advance(10_000);
		expect(calls).toEqual([0, 10_000, 20_000]);
	});

	it("makes zero calls while hidden and resumes with an immediate run", async () => {
		const { calls, clock, poller } = setup();
		poller.setVisible(true);
		await flush();
		poller.setVisible(false);
		await clock.advance(60_000);
		expect(calls).toEqual([0]);
		expect(clock.pendingCount()).toBe(0);
		poller.setVisible(true);
		expect(calls).toEqual([0, 60_000]);
	});

	it("dispose cancels the pending run", async () => {
		const { calls, clock, poller } = setup();
		poller.setVisible(true);
		poller.dispose();
		await clock.advance(30_000);
		expect(calls).toEqual([0]);
		expect(clock.pendingCount()).toBe(0);
	});

	it("ignores repeated visible and does not double the schedule", async () => {
		const { calls, clock, poller } = setup();
		poller.setVisible(true);
		poller.setVisible(true);
		await flush();
		await clock.advance(10_000);
		expect(calls).toEqual([0, 10_000]);
	});

	it("skips ticks while the previous run is still pending", async () => {
		const clock = fakeClock();
		let release: () => void = () => undefined;
		let started = 0;
		const poller = createPoller({
			intervalMs: 10_000,
			now: clock.now,
			run: () => {
				started += 1;
				return new Promise<void>((resolve) => {
					release = resolve;
				});
			},
			schedule: clock.schedule,
		});
		poller.setVisible(true);
		await clock.advance(30_000);
		expect(started).toBe(1);
		release();
		await flush();
		await clock.advance(10_000);
		expect(started).toBe(2);
	});
});

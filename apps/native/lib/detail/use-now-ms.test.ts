import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";

import { startClock } from "./use-now-ms";

describe("startClock", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it("reports the current time on every tick until stopped", () => {
		let current = 1000;
		const seen: number[] = [];
		const stop = startClock(
			(now) => seen.push(now),
			1000,
			() => current
		);
		current = 2000;
		jest.advanceTimersByTime(1000);
		current = 3000;
		jest.advanceTimersByTime(1000);
		expect(seen).toEqual([2000, 3000]);
		stop();
		jest.advanceTimersByTime(5000);
		expect(seen).toEqual([2000, 3000]);
	});
});

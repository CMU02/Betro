import { describe, expect, it } from "bun:test";
import type { StationView } from "./detail-client";
import {
	settleStationView,
	stationPollInterval,
	stationViewPhase,
} from "./station-view-poll";

const VIEW: StationView = {
	generatedAt: 1,
	stations: [],
	timezone: "Asia/Seoul",
};
const GOOD = { ok: true, value: VIEW } as const;
const BAD = { ok: false, reason: "unavailable" } as const;

describe("station-view-poll", () => {
	it("폴링이 실패해도 마지막 좋은 도착판과 받은 시각을 둔다", () => {
		const first = settleStationView(undefined, GOOD, 1000);
		const next = settleStationView(first, BAD, 2000);
		expect(next).toEqual({ receivedAt: 1000, result: GOOD });
	});

	it("받은 적이 없으면 실패를 그대로 낸다", () => {
		expect(settleStationView(undefined, BAD, 5)).toEqual({
			receivedAt: 5,
			result: BAD,
		});
	});

	it("성공하면 새 응답과 시각으로 바꾼다", () => {
		const first = settleStationView(undefined, GOOD, 1000);
		expect(settleStationView(first, GOOD, 2000).receivedAt).toBe(2000);
	});

	it("보이지 않는 동안은 폴링하지 않는다", () => {
		expect(stationPollInterval(false, 15_000)).toBe(false);
		expect(stationPollInterval(true, 15_000)).toBe(15_000);
	});

	it("첫 응답 전에는 loading, 실패만 받았으면 failed다", () => {
		expect(stationViewPhase(undefined)).toBe("loading");
		expect(stationViewPhase(settleStationView(undefined, BAD, 1))).toBe(
			"failed"
		);
		expect(stationViewPhase(settleStationView(undefined, GOOD, 1))).toBe(
			"ready"
		);
	});
});

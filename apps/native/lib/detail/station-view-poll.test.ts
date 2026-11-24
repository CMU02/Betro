import { describe, expect, it } from "bun:test";
import type { StationView } from "./detail-client";
import { LIVE_STALE_AFTER_MS } from "./live-stale";
import { stationModel } from "./station-model";
import {
	settleStationView,
	stationPollInterval,
	stationPollOptions,
	stationViewAt,
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

describe("stationPollOptions", () => {
	it("가려진 동안은 쿼리를 끄고, 다시 보이면 켜서 오래된 도착판을 바로 새로 받게 한다", () => {
		expect(stationPollOptions(false, 15_000)).toEqual({
			enabled: false,
			refetchInterval: false,
		});
		expect(stationPollOptions(true, 15_000)).toEqual({
			enabled: true,
			refetchInterval: 15_000,
		});
	});
});

describe("stationViewAt", () => {
	const NOW = Date.UTC(2026, 10, 24, 0, 0);
	const MIN = 60_000;
	const LIVE_VIEW: StationView = {
		generatedAt: NOW,
		stations: [
			{
				directions: [
					{
						approaching: [
							{
								etaAt: NOW + 3 * MIN,
								method: null,
								stopsAway: 2,
								vehicleId: "2042",
							},
							{
								etaAt: NOW + 9 * MIN,
								method: null,
								stopsAway: 5,
								vehicleId: "2044",
							},
						],
						direction: "up",
						etaState: "live",
						firstAt: null,
						headwayMs: null,
						lastAt: null,
					},
				],
				line: "seoul-subway:line2",
				stop: "seoul-subway:s2",
			},
		],
		timezone: "Asia/Seoul",
	};
	const LIVE = { ok: true, value: LIVE_VIEW } as const;

	it("받은 적이 없거나 실패만 받았으면 null이다", () => {
		expect(stationViewAt(undefined, NOW)).toBeNull();
		expect(
			stationViewAt(settleStationView(undefined, BAD, NOW), NOW)
		).toBeNull();
	});

	it("받은 지 묵음 기준 안이면 받은 도착판을 그대로 낸다", () => {
		const snapshot = settleStationView(undefined, LIVE, NOW);
		expect(stationViewAt(snapshot, NOW + LIVE_STALE_AFTER_MS)).toBe(LIVE_VIEW);
	});

	// 서버 401·503이 10분 이어져도 마지막 도착판이 남는다. 이미 떠난 열차를 실시간으로 그리지 않는다.
	it("폴링이 묵음 기준보다 오래 실패하면 추정으로 내리고 이미 지난 도착은 뺀다", () => {
		let snapshot = settleStationView(undefined, LIVE, NOW);
		snapshot = settleStationView(snapshot, BAD, NOW + 5 * MIN);
		const now = NOW + 5 * MIN;
		const stale = stationViewAt(snapshot, now);
		const direction = stale?.stations[0]?.directions[0];
		expect(direction?.etaState).toBe("estimated");
		expect(direction?.approaching.map((entry) => entry.vehicleId)).toEqual([
			"2044",
		]);
		const rows = stationModel(stale as StationView, {}, now)[0]?.directions[0]
			?.rows;
		expect(rows?.map((row) => row.status.kind)).toEqual(["estimated"]);
	});
});

import { describe, expect, it } from "bun:test";
import type { BusMap } from "@/lib/map/map-client";
import { busRouteModel } from "./bus-route-model";
import {
	busRouteUnavailable,
	busRouteViewAt,
	settleBusRouteView,
} from "./bus-route-view-poll";
import type { BusRouteViewResponse } from "./detail-client";
import { LIVE_STALE_AFTER_MS } from "./live-stale";

const NOW = Date.UTC(2026, 10, 24, 3, 0);
const MIN = 60_000;

const VIEW: BusRouteViewResponse = {
	etaState: "live",
	fetchedAt: NOW,
	headwayMs: 8 * MIN,
	route: { name: "146", routeType: "3", shortName: "146" },
	stops: [
		{
			seq: 2,
			vehicles: [
				{ etaAt: NOW + 3 * MIN, plate: null, stopsAway: 1, vehicleId: "v1" },
			],
		},
	],
};
const GOOD = { ok: true, value: VIEW } as const;
const OFFLINE = { ok: false, reason: "offline" } as const;
const INVALID = { ok: false, reason: "invalid" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

const MAP: BusMap = {
	batchId: 1,
	line: "seoul-bus:100100118",
	shape: [],
	stops: [1, 2, 3].map((seq) => ({
		arsId: null,
		directionName: null,
		lat: 37,
		lng: 127,
		name: `정류장${seq}`,
		seq,
		stop: `seoul-bus:S${seq}`,
	})),
};

describe("bus-route-view-poll", () => {
	it("폴링이 실패해도 마지막 좋은 노선 보기와 받은 시각을 둔다", () => {
		const first = settleBusRouteView(undefined, GOOD, 1000);
		expect(settleBusRouteView(first, OFFLINE, 2000)).toEqual({
			receivedAt: 1000,
			result: GOOD,
		});
	});

	it("받은 적이 없으면 실패를 그대로 낸다", () => {
		expect(settleBusRouteView(undefined, OFFLINE, 5)).toEqual({
			receivedAt: 5,
			result: OFFLINE,
		});
	});

	it("새 성공은 이전 값과 시각을 덮는다", () => {
		const first = settleBusRouteView(undefined, GOOD, 1000);
		const next = { ok: true, value: { ...VIEW } } as const;
		expect(settleBusRouteView(first, next, 2000)).toEqual({
			receivedAt: 2000,
			result: next,
		});
	});

	it("서버가 모르는 노선(invalid)일 때만 찾을 수 없음이다", () => {
		const at = (result: Parameters<typeof settleBusRouteView>[1]) =>
			settleBusRouteView(undefined, result, 0);
		expect(busRouteUnavailable(at(INVALID))).toBe(true);
		expect(busRouteUnavailable(at(OFFLINE))).toBe(false);
		expect(busRouteUnavailable(at(UNAVAILABLE))).toBe(false);
		expect(busRouteUnavailable(at(GOOD))).toBe(false);
		expect(busRouteUnavailable(undefined)).toBe(false);
	});
});

describe("busRouteViewAt", () => {
	it("받은 적이 없거나 실패만 받았으면 null이다", () => {
		expect(busRouteViewAt(undefined, NOW)).toBeNull();
		expect(
			busRouteViewAt(settleBusRouteView(undefined, UNAVAILABLE, NOW), NOW)
		).toBeNull();
	});

	it("받은 지 묵음 기준 안이면 받은 노선 보기를 그대로 낸다", () => {
		const snapshot = settleBusRouteView(undefined, GOOD, NOW);
		expect(busRouteViewAt(snapshot, NOW + LIVE_STALE_AFTER_MS)).toBe(VIEW);
	});

	// 서버 500·503이 이어지면 마지막 응답이 남는다. 그 응답을 실시간으로 그리지 않는다.
	it("폴링이 묵음 기준보다 오래 실패하면 추정으로 내리고 정류장 도착을 비운다", () => {
		let snapshot = settleBusRouteView(undefined, GOOD, NOW);
		snapshot = settleBusRouteView(snapshot, UNAVAILABLE, NOW + MIN);
		const stale = busRouteViewAt(snapshot, NOW + LIVE_STALE_AFTER_MS + 1);
		expect(stale).toEqual({ ...VIEW, etaState: "estimated", stops: [] });
	});

	it("묵은 노선 보기로 만든 모델에는 실시간 도착이 없고 고른 정류장에 배차간격만 있다", () => {
		let snapshot = settleBusRouteView(undefined, GOOD, NOW);
		snapshot = settleBusRouteView(snapshot, UNAVAILABLE, NOW + MIN);
		const now = NOW + 10 * MIN;
		const model = busRouteModel({
			map: MAP,
			now,
			selectedDirection: null,
			selectedSeq: 2,
			selectedVehicleId: null,
			vehicles: [],
			view: busRouteViewAt(snapshot, now),
		});
		expect(model.stops.map((entry) => entry.status?.kind ?? null)).toEqual([
			null,
			"estimated",
			null,
		]);
		expect(model.headway?.kind).toBe("estimated");
	});
});

import { describe, expect, it } from "bun:test";
import { busRouteUnavailable, settleBusRouteView } from "./bus-route-view-poll";
import type { BusRouteViewResponse } from "./detail-client";

const VIEW = { etaState: "live" } as BusRouteViewResponse;
const GOOD = { ok: true, value: VIEW } as const;
const OFFLINE = { ok: false, reason: "offline" } as const;
const INVALID = { ok: false, reason: "invalid" } as const;

describe("bus-route-view-poll", () => {
	it("폴링이 실패해도 마지막 좋은 노선 보기를 둔다", () => {
		expect(settleBusRouteView(GOOD, OFFLINE)).toBe(GOOD);
	});

	it("받은 적이 없으면 실패를 그대로 낸다", () => {
		expect(settleBusRouteView(undefined, OFFLINE)).toBe(OFFLINE);
	});

	it("새 성공은 이전 값을 덮는다", () => {
		const next = { ok: true, value: { ...VIEW } } as const;
		expect(settleBusRouteView(GOOD, next)).toBe(next);
	});

	it("서버가 모르는 노선(invalid)일 때만 찾을 수 없음이다", () => {
		expect(busRouteUnavailable(INVALID)).toBe(true);
		expect(busRouteUnavailable(OFFLINE)).toBe(false);
		expect(busRouteUnavailable({ ok: false, reason: "unavailable" })).toBe(
			false
		);
		expect(busRouteUnavailable(GOOD)).toBe(false);
		expect(busRouteUnavailable(undefined)).toBe(false);
	});
});

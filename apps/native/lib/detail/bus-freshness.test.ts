import { describe, expect, test } from "bun:test";

import { busFreshnessOf } from "./bus-freshness";

describe("busFreshnessOf", () => {
	test("실시간 도착이면 운행 대수와 실시간 안내를 보인다", () => {
		expect(busFreshnessOf({ etaState: "live", running: 3 })).toEqual({
			live: true,
			showNotice: true,
			showRunning: true,
		});
	});

	test("도착 응답이 없어도 지도에 차량이 있으면 실시간이다", () => {
		expect(busFreshnessOf({ etaState: null, running: 2 })).toEqual({
			live: true,
			showNotice: true,
			showRunning: true,
		});
	});

	test("실시간 자료가 없을 때 0대 운행 중과 실시간 안내를 보이지 않는다", () => {
		expect(busFreshnessOf({ etaState: null, running: 0 })).toEqual({
			live: false,
			showNotice: false,
			showRunning: false,
		});
		expect(busFreshnessOf({ etaState: "estimated", running: 0 })).toEqual({
			live: false,
			showNotice: false,
			showRunning: false,
		});
	});

	test("시간표 추정이어도 지도에 차량이 보이면 대수는 보이고 실시간 안내는 숨긴다", () => {
		expect(busFreshnessOf({ etaState: "estimated", running: 4 })).toEqual({
			live: false,
			showNotice: false,
			showRunning: true,
		});
	});
});

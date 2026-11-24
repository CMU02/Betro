import { describe, expect, it } from "bun:test";

import type { StopRoutes } from "./detail-client";
import { stopModel } from "./stop-model";

// 2026-11-24 12:00 KST (UTC 03:00)
const NOON = Date.UTC(2026, 10, 24, 3, 0);
// 2026-11-24 02:00 KST (UTC 前日 17:00)
const NIGHT = Date.UTC(2026, 10, 23, 17, 0);

const route = (
	over: Partial<StopRoutes["routes"][number]> = {}
): StopRoutes["routes"][number] => ({
	directionName: "강남역",
	firstBusMinute: 5 * 60,
	headwayMin: 8,
	lastBusMinute: 23 * 60,
	line: "seoul-bus:100100",
	nextStopName: null,
	routeType: "3",
	seq: 12,
	shortName: "146",
	...over,
});

const stops = (routes: StopRoutes["routes"]): StopRoutes => ({
	arsId: "23001",
	lat: 37,
	lng: 127,
	name: "테스트 정류장",
	routes,
	stop: "seoul-bus:111",
	timezone: "Asia/Seoul",
});

describe("stopModel", () => {
	it("운행 시간 안이면 배차 약 N분, 밖이면 운행 종료다", () => {
		const [day] = stopModel(stops([route()]), NOON);
		expect(day?.status).toEqual({ kind: "estimated", text: "배차 약 8분" });
		const [night] = stopModel(stops([route()]), NIGHT);
		expect(night?.status).toEqual({ kind: "ended", text: "운행 종료" });
	});

	it("방면이 없는 노선은 directionLabel이 null이다", () => {
		const [row] = stopModel(stops([route({ directionName: null })]), NOON);
		expect(row?.directionLabel).toBeNull();
		const [named] = stopModel(stops([route()]), NOON);
		expect(named?.directionLabel).toBe("강남역 방면");
	});

	it("headwayMin이 null인 노선은 운행 종료가 아니라 status가 null이다", () => {
		const rows = stopModel(
			stops([route({ headwayMin: null }), route({ headwayMin: 0 })]),
			NIGHT
		);
		expect(rows.map((row) => row.status)).toEqual([null, null]);
	});

	it("href는 노선과 이 정류장의 순번을 담는다", () => {
		const [row] = stopModel(stops([route()]), NOON);
		expect(row?.href).toBe("/bus/seoul-bus%3A100100?stop=12");
		expect(row?.line).toBe("seoul-bus:100100");
		expect(row?.shortName).toBe("146");
	});
});

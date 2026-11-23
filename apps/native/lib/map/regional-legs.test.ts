import type { Leg, Route } from "@Betro/commute/plan";
import type { LineRef, StopRef } from "@Betro/commute/refs";
import { expect, it } from "bun:test";

import { hasLiveData, mapLegFlags, watchRefsOf } from "./regional-legs";

function busLeg(line: string): Leg {
	return {
		alight: { name: "B", seq: 5, stop: `${line}-b` as StopRef },
		board: { name: "A", seq: 1, stop: `${line}-a` as StopRef },
		line: line as LineRef,
		lineName: "11",
		mode: "bus",
	};
}

const SUBWAY: Leg = {
	alight: { name: "B", stop: "seoul-subway:1002000222" as StopRef },
	board: { name: "A", stop: "seoul-subway:1002000216" as StopRef },
	direction: "up",
	line: "seoul-subway:line2" as LineRef,
	lineName: "2호선",
	mode: "subway",
};

function routeOf(...legs: Leg[]): Route {
	return { legs, rank: 0 } as unknown as Route;
}

it("멈춘 출처가 없으면 모든 노선이 실시간이다", () => {
	expect(hasLiveData("gbis:200000101", [])).toBe(true);
	expect(hasLiveData("tago:ICB165000012", [])).toBe(true);
	expect(hasLiveData("seoul-bus:100100341", [])).toBe(true);
	expect(hasLiveData("seoul-subway:line2", ["gbis", "tago"])).toBe(true);
});

it("gbis가 멈춘 날에만 gbis 구간이 noRealtime이고 tago는 차량을 그린다", () => {
	const route = routeOf(
		busLeg("gbis:200000101"),
		busLeg("tago:ICB165000012"),
		SUBWAY
	);
	const flags = mapLegFlags(route, [], ["gbis"]);
	expect(
		flags.map(({ realtime, showVehicles }) => [realtime, showVehicles])
	).toEqual([
		[false, false],
		[true, true],
		[true, true],
	]);
});

it("멈춘 출처가 없으면 gbis 구간도 차량을 그린다", () => {
	const [flag] = mapLegFlags(routeOf(busLeg("gbis:1")), [], []);
	expect(flag?.realtime).toBe(true);
	expect(flag?.showVehicles).toBe(true);
});

it("keeps a hidden Seoul line hidden and real-time", () => {
	const route = routeOf(busLeg("seoul-bus:1"));
	const [flag] = mapLegFlags(route, ["seoul-bus:1"], ["gbis"]);
	expect(flag?.realtime).toBe(true);
	expect(flag?.showVehicles).toBe(false);
});

it("관측 요청(하트비트)에는 서울·경기·인천 버스 노선을 중복 없이 보낸다", () => {
	const route = routeOf(
		busLeg("gbis:200000101"),
		busLeg("tago:ICB165000012"),
		busLeg("seoul-bus:100100341"),
		busLeg("seoul-bus:100100341"),
		SUBWAY
	);
	expect(watchRefsOf(route)).toEqual([
		"gbis:200000101",
		"tago:ICB165000012",
		"seoul-bus:100100341",
	]);
});

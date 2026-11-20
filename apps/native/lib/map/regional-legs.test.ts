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

it("treats only GBIS and TAGO lines as having no live data", () => {
	expect(hasLiveData("gbis:200000101")).toBe(false);
	expect(hasLiveData("tago:ICB165000012")).toBe(false);
	expect(hasLiveData("seoul-bus:100100341")).toBe(true);
	expect(hasLiveData("seoul-subway:line2")).toBe(true);
});

it("turns vehicles off for a GBIS leg even when its line is not hidden", () => {
	const route = routeOf(busLeg("gbis:200000101"), SUBWAY);
	const flags = mapLegFlags(route, []);
	expect(
		flags.map(({ realtime, showVehicles }) => [realtime, showVehicles])
	).toEqual([
		[false, false],
		[true, true],
	]);
});

it("keeps a hidden Seoul line hidden and real-time", () => {
	const route = routeOf(busLeg("seoul-bus:1"));
	const [flag] = mapLegFlags(route, ["seoul-bus:1"]);
	expect(flag?.realtime).toBe(true);
	expect(flag?.showVehicles).toBe(false);
});

it("sends heartbeat refs only for Seoul bus lines", () => {
	const route = routeOf(
		busLeg("gbis:200000101"),
		busLeg("tago:ICB165000012"),
		busLeg("seoul-bus:100100341"),
		busLeg("seoul-bus:100100341"),
		SUBWAY
	);
	expect(watchRefsOf(route)).toEqual(["seoul-bus:100100341"]);
	expect(watchRefsOf(routeOf(busLeg("gbis:1")))).toEqual([]);
});

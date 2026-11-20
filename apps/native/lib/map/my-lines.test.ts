import type { CommutePlan, Leg } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import type { Place } from "../places/places";
import { myLines } from "./my-lines";

function busLeg(line: string, lineName: string): Leg {
	return {
		alight: { name: "도착", seq: 20, stop: "seoul-bus:S20" },
		board: { name: "승차", seq: 10, stop: "seoul-bus:S10" },
		line: line as Leg["line"],
		lineName,
		mode: "bus",
	};
}

function subwayLeg(line: string, lineName: string): Leg {
	return {
		alight: { name: "삼성", stop: "seoul-subway:1002000223" },
		board: { name: "강남", stop: "seoul-subway:1002000222" },
		direction: "up",
		line: line as Leg["line"],
		lineName,
		mode: "subway",
	};
}

function place(id: string, routes: Leg[][]): Place {
	const plan = {
		routes: routes.map((legs, rank) => ({ legs, rank, walkMinutes: [] })),
	} as unknown as CommutePlan;
	return {
		busMeta: { "seoul-bus:R1": { region: "gyeonggi", routeType: "8" } },
		id,
		kind: "home",
		name: id,
		plan,
		sync: "synced",
		updatedAt: 0,
	};
}

it("dedupes lines across places and routes, subway first", () => {
	const places = [
		place("a", [
			[busLeg("seoul-bus:R2", "470"), subwayLeg("seoul-subway:line2", "2호선")],
			[busLeg("seoul-bus:R1", "146")],
		]),
		place("b", [
			[subwayLeg("seoul-subway:line2", "2호선")],
			[busLeg("seoul-bus:R1", "146")],
			[subwayLeg("seoul-subway:line1", "1호선")],
		]),
	];
	const lines = myLines(places);
	expect(lines.map((entry) => entry.line)).toEqual([
		"seoul-subway:line1",
		"seoul-subway:line2",
		"seoul-bus:R1",
		"seoul-bus:R2",
	]);
	expect(lines.map((entry) => entry.mode)).toEqual([
		"subway",
		"subway",
		"bus",
		"bus",
	]);
	expect(lines[2]?.badge).toEqual({
		mode: "bus",
		name: "146",
		region: "gyeonggi",
		routeType: "8",
	});
});

it("returns an empty list when there are no places", () => {
	expect(myLines([])).toEqual([]);
});

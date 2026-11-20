import { expect, it } from "bun:test";
import type { SubwayMap, SubwaySnapshotVehicle } from "./map-client";
import { branchForTrain, trainsNear, trainsOnLines } from "./nearby-trains";

function train(
	rawTrainNo: string,
	lineKey: string,
	direction: "up" | "down",
	statnId: string | null
): SubwaySnapshotVehicle {
	return {
		direction,
		lastSeenAt: 0,
		lineKey,
		observedAt: 0,
		rawTrainNo,
		stationDistanceM: null,
		statnId,
		status: "depart",
	};
}

const station = (seq: number, stop: string) => ({
	lat: 37,
	lng: 127,
	name: stop,
	nextRunSec: 120,
	offsetM: 0,
	seq,
	stop,
});

const map: SubwayMap = {
	batchId: 1,
	branches: [
		{
			branchKey: "main-up",
			direction: "up",
			shape: [],
			stations: [station(1, "seoul-subway:A"), station(2, "seoul-subway:B")],
		},
		{
			branchKey: "main-down",
			direction: "down",
			shape: [],
			stations: [station(1, "seoul-subway:B"), station(2, "seoul-subway:A")],
		},
		{
			branchKey: "spur-down",
			direction: "down",
			shape: [],
			stations: [station(1, "seoul-subway:C")],
		},
	],
	line: "seoul-subway:line2",
};

it("keeps trains of the nearby lines only, matching the bare line key", () => {
	const trains = [
		train("1", "line2", "up", "A"),
		train("2", "line3", "up", "A"),
		train("3", "line5", "down", "A"),
	];
	expect(
		trainsOnLines(trains, ["seoul-subway:line2", "seoul-subway:line5"]).map(
			(item) => item.rawTrainNo
		)
	).toEqual(["1", "3"]);
	expect(trainsOnLines(trains, [])).toEqual([]);
});

it("finds the branch running in the train's direction through its station", () => {
	expect(branchForTrain(map, train("1", "line2", "down", "C"))?.branchKey).toBe(
		"spur-down"
	);
	expect(branchForTrain(map, train("1", "line2", "up", "B"))?.branchKey).toBe(
		"main-up"
	);
	expect(branchForTrain(map, train("1", "line2", "up", "C"))).toBeNull();
	expect(branchForTrain(map, train("1", "line2", "up", null))).toBeNull();
});

it("draws only trains within the radius of my position", () => {
	const here = { latitude: 37.5, longitude: 127 };
	const near = {
		id: "near",
		observedPosition: { latitude: 37.51, longitude: 127 },
	};
	const far = {
		id: "far",
		observedPosition: { latitude: 37.6, longitude: 127 },
	};
	expect(trainsNear([near, far], here, 3000).map((item) => item.id)).toEqual([
		"near",
	]);
});

import type { BusLeg, Route, SubwayLeg } from "@Betro/commute/plan";
import { expect, it } from "bun:test";
import {
	allLinesHidden,
	busVehiclesForLeg,
	subwayVehiclesForLeg,
	visibleLegs,
} from "./leg-vehicles";
import type {
	BusMap,
	BusSnapshotVehicle,
	SubwayMap,
	SubwaySnapshotVehicle,
} from "./map-client";

const busLeg: BusLeg = {
	alight: { name: "도착", seq: 30, stop: "seoul-bus:S30" },
	board: { name: "승차", seq: 10, stop: "seoul-bus:S10" },
	line: "seoul-bus:R1",
	lineName: "470",
	mode: "bus",
};

const subwayLeg: SubwayLeg = {
	alight: { name: "삼성", stop: "seoul-subway:1002000223" },
	board: { name: "강남", stop: "seoul-subway:1002000222" },
	direction: "up",
	line: "seoul-subway:2",
	lineName: "2호선",
	mode: "subway",
};

function bus(
	vehId: string,
	sectOrd: number,
	routeId = "R1"
): BusSnapshotVehicle {
	return {
		lastSeenAt: 0,
		lat: 37,
		lng: 127,
		observedAt: 0,
		routeId,
		sectOrd,
		vehId,
	};
}

function train(
	rawTrainNo: string,
	statnId: string | null,
	direction: "up" | "down" = "up",
	lineKey = "2"
): SubwaySnapshotVehicle {
	return {
		direction,
		lastSeenAt: 0,
		lineKey,
		observedAt: 0,
		rawTrainNo,
		stationDistanceM: null,
		statnId,
		status: "arrive",
	};
}

function busMapOf(stopCount: number, circular: boolean): BusMap {
	const stops = Array.from({ length: stopCount }, (_, index) => ({
		arsId: null,
		lat: 37,
		lng: 127,
		name: `s${index}`,
		seq: index + 1,
		stop: `seoul-bus:S${circular && index === stopCount - 1 ? 1 : index + 1}`,
	}));
	return { batchId: 1, line: "seoul-bus:R1", shape: [], stops };
}

const subwayMap: SubwayMap = {
	batchId: 1,
	branches: [
		{
			branchKey: "main-up",
			direction: "up",
			shape: [],
			stations: ["1002000221", "1002000222", "1002000223"].map((id, index) => ({
				lat: 37,
				lng: 127,
				name: id,
				nextRunSec: null,
				offsetM: index * 1000,
				seq: index + 1,
				stop: `seoul-subway:${id}`,
			})),
		},
		{
			branchKey: "main-down",
			direction: "down",
			shape: [],
			stations: ["1002000223", "1002000222", "1002000221"].map((id, index) => ({
				lat: 37,
				lng: 127,
				name: id,
				nextRunSec: null,
				offsetM: index * 1000,
				seq: index + 1,
				stop: `seoul-subway:${id}`,
			})),
		},
	],
	line: "seoul-subway:2",
};

it("keeps buses with sectOrd before the boarding seq and drops those past it", () => {
	const result = busVehiclesForLeg(
		busLeg,
		[bus("a", 5), bus("b", 10), bus("c", 12), bus("d", 3, "R2")],
		null,
		busMapOf(40, false)
	);
	expect(result.map((v) => v.vehId)).toEqual(["a"]);
});

it("on a circular route keeps only the approaching half lap", () => {
	// 정류장 40개(마지막이 첫 정류장과 같음), 승차 순번 25: 5 초과 25 미만만 남는다.
	const leg: BusLeg = { ...busLeg, board: { ...busLeg.board, seq: 25 } };
	const result = busVehiclesForLeg(
		leg,
		[bus("far", 3), bus("edge", 5), bus("near", 20), bus("past", 30)],
		null,
		busMapOf(40, true)
	);
	expect(result.map((v) => v.vehId)).toEqual(["near"]);
});

it("keeps only the boarded vehicle when boardedVehicleId is given", () => {
	const result = busVehiclesForLeg(
		busLeg,
		[bus("a", 5), bus("mine", 20), bus("late", 31)],
		"mine",
		busMapOf(40, false)
	);
	expect(result.map((v) => v.vehId)).toEqual(["mine"]);
	const past = busVehiclesForLeg(busLeg, [bus("mine", 31)], "mine", null);
	expect(past).toEqual([]);
	const train2 = subwayVehiclesForLeg(
		subwayLeg,
		[train("T1", "1002000223"), train("T2", "1002000221")],
		subwayMap,
		"T1"
	);
	expect(train2.map((v) => v.rawTrainNo)).toEqual(["T1"]);
});

it("keeps subway trains in the leg direction before the boarding station", () => {
	const result = subwayVehiclesForLeg(
		subwayLeg,
		[
			train("before", "1002000221"),
			train("at", "1002000222"),
			train("past", "1002000223"),
			train("wrong-dir", "1002000221", "down"),
			train("other-line", "1002000221", "up", "3"),
			train("unknown", null),
		],
		subwayMap,
		null
	);
	expect(result.map((v) => v.rawTrainNo)).toEqual(["before"]);
});

it("hidden lines keep the line but hide vehicles; allLinesHidden true when every leg line is hidden", () => {
	const route: Route = {
		legs: [busLeg, subwayLeg],
		rank: 0,
		walkMinutes: [1, 1, 1],
	};
	const some = visibleLegs(route, ["seoul-bus:R1"]);
	expect(some.map((entry) => entry.showVehicles)).toEqual([false, true]);
	expect(some).toHaveLength(2);
	expect(allLinesHidden(route, ["seoul-bus:R1"])).toBe(false);
	expect(allLinesHidden(route, ["seoul-bus:R1", "seoul-subway:2"])).toBe(true);
	expect(allLinesHidden({ ...route, legs: [] }, ["x"])).toBe(false);
});

function loopMapOf(stationCount: number): SubwayMap {
	const stations = Array.from({ length: stationCount }, (_, index) => ({
		lat: 37,
		lng: 127,
		name: `L${index}`,
		nextRunSec: null,
		offsetM: index * 1000,
		seq: index,
		stop: `seoul-subway:L${index}`,
	}));
	return {
		batchId: 1,
		branches: [{ branchKey: "main", direction: "up", shape: [], stations }],
		line: "seoul-subway:2",
	};
}

function loopLegAt(boardIndex: number): SubwayLeg {
	return {
		...subwayLeg,
		alight: { name: "a", stop: "seoul-subway:L10" },
		board: { name: "b", stop: `seoul-subway:L${boardIndex}` },
	};
}

it("keeps loop-line trains just behind the boarding station across the seam", () => {
	const map = loopMapOf(43);
	const result = subwayVehiclesForLeg(
		loopLegAt(0),
		[
			train("n1", "L42"),
			train("n3", "L40"),
			train("n13", "L30"),
			train("far", "L5"),
		],
		map,
		null
	);
	expect(result.map((v) => v.rawTrainNo)).toEqual(["n1", "n3", "n13"]);
});

it("drops loop-line trains more than half a lap behind the boarding station", () => {
	const map = loopMapOf(43);
	const result = subwayVehiclesForLeg(
		loopLegAt(42),
		[train("near", "L41"), train("seam", "L0"), train("seam2", "L1")],
		map,
		null
	);
	expect(result.map((v) => v.rawTrainNo)).toEqual(["near"]);
});

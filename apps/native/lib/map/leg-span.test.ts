import type { BusLeg, SubwayLeg } from "@Betro/commute/plan";
import { expect, it } from "bun:test";
import { legSpanM } from "./leg-span";
import type { BusTrack, SubwayTrack } from "./motion";

const SHAPE: [number, number][] = [
	[127, 37.5],
	[127.01, 37.5],
];

const busLeg: BusLeg = {
	alight: { name: "도착", seq: 30, stop: "seoul-bus:S30" },
	board: { name: "승차", seq: 10, stop: "seoul-bus:S10" },
	line: "seoul-bus:R1",
	lineName: "470",
	mode: "bus",
};

const subwayLeg: SubwayLeg = {
	alight: { name: "삼성", stop: "seoul-subway:C" },
	board: { name: "강남", stop: "seoul-subway:A" },
	direction: "up",
	line: "seoul-subway:2",
	lineName: "2호선",
	mode: "subway",
};

it("reads bus board and alight distances by seq", () => {
	const track: BusTrack = {
		shape: SHAPE,
		stopDistanceBySeq: new Map([
			[10, 100],
			[30, 700],
		]),
		stopSeqs: [10, 30],
	};
	expect(legSpanM(busLeg, { kind: "bus", track })).toEqual({
		alightM: 700,
		boardM: 100,
	});
});

it("reads subway distances by stop and gives null for unknown stops", () => {
	const track: SubwayTrack = {
		shape: SHAPE,
		stations: [
			{ distanceM: 50, nextRunSec: 90, stop: "seoul-subway:A" },
			{ distanceM: 400, nextRunSec: null, stop: "seoul-subway:B" },
		],
	};
	expect(legSpanM(subwayLeg, { kind: "subway", track })).toEqual({
		alightM: null,
		boardM: 50,
	});
});

it("gives no span without a track", () => {
	expect(legSpanM(busLeg, null)).toEqual({ alightM: null, boardM: null });
});

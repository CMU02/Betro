import type { BusLeg, SubwayLeg } from "@Betro/commute/plan";
import { expect, it } from "bun:test";
import type { BusMap, RouteViewLeg, SubwayMap } from "./map-client";
import { sheetModel } from "./sheet-model";

const NOW = 1_000_000;

const busLeg: BusLeg = {
	alight: { name: "도착", seq: 9, stop: "seoul-bus:S9" },
	board: { name: "넷", seq: 4, stop: "seoul-bus:S4" },
	line: "seoul-bus:R1",
	lineName: "470",
	mode: "bus",
};

const busStop = (seq: number, name: string) => ({
	arsId: null,
	lat: 37,
	lng: 127,
	name,
	seq,
	stop: `seoul-bus:S${seq}`,
});

const busMap: BusMap = {
	batchId: 1,
	line: "seoul-bus:R1",
	shape: [],
	stops: [
		busStop(1, "하나"),
		busStop(2, "둘"),
		busStop(3, "셋"),
		busStop(4, "넷"),
		busStop(9, "종점"),
	],
};

const emptyView = (approaching: RouteViewLeg["approaching"]): RouteViewLeg => ({
	approaching,
	boardEtaAt: null,
	etaState: "live",
	method: null,
	positionState: "live",
	vehicleId: null,
});

it("bus sheet lists one past stop, now, next stops and ends at my stop with minutes from approaching", () => {
	const model = sheetModel({
		leg: busLeg,
		map: busMap,
		nowMs: NOW,
		observedAt: NOW - 12_900,
		positionSeq: 2,
		vehicleId: "V1",
		view: emptyView([
			{
				etaAt: NOW + 190_000,
				method: "official",
				stopsAway: 2,
				vehicleId: "V1",
			},
		]),
	});
	expect(model.lineLabel).toBe("470");
	expect(model.directionKey).toBe("map.sheet.direction.bus");
	expect(model.directionParams).toEqual({ name: "종점" });
	expect(model.freshness).toEqual({ live: true, secondsAgo: 12 });
	expect(model.trainNo).toBeNull();
	expect(model.stops).toEqual([
		{ name: "하나", state: "past" },
		{ name: "둘", state: "now" },
		{ name: "셋", state: "next" },
		{ name: "넷", state: "mine" },
	]);
	expect(model.minutesToMine).toBe(3);
	expect(model.estimated).toBe(false);
});

it("no minutes when the vehicle is not on the boarding board", () => {
	const model = sheetModel({
		leg: busLeg,
		map: busMap,
		nowMs: NOW,
		observedAt: NOW,
		positionSeq: 1,
		vehicleId: "V1",
		view: emptyView([
			{
				etaAt: NOW + 60_000,
				method: "official",
				stopsAway: 1,
				vehicleId: "V2",
			},
		]),
	});
	expect(model.minutesToMine).toBeNull();
	expect(model.estimated).toBe(false);
	expect(model.stops[0]).toEqual({ name: "하나", state: "now" });
});

it("marks estimated when method is headway", () => {
	const model = sheetModel({
		leg: busLeg,
		map: busMap,
		nowMs: NOW,
		observedAt: NOW,
		positionSeq: 2,
		vehicleId: "V1",
		view: emptyView([
			{
				etaAt: NOW + 420_000,
				method: "headway",
				stopsAway: 2,
				vehicleId: "V1",
			},
		]),
	});
	expect(model.estimated).toBe(true);
	expect(model.minutesToMine).toBe(7);
});

it("has no minutes without a route view", () => {
	const model = sheetModel({
		leg: busLeg,
		map: busMap,
		nowMs: NOW,
		observedAt: NOW - 400_000,
		positionSeq: 2,
		vehicleId: "V1",
		view: null,
	});
	expect(model.minutesToMine).toBeNull();
	expect(model.freshness.live).toBe(false);
});

const station = (seq: number, name: string) => ({
	lat: 37,
	lng: 127,
	name,
	nextRunSec: null,
	offsetM: seq * 1000,
	seq,
	stop: `seoul-subway:S${seq}`,
});

const loopMap: SubwayMap = {
	batchId: 1,
	branches: [
		{
			branchKey: "main",
			direction: "up",
			shape: [],
			stations: [
				station(1, "가"),
				station(2, "나"),
				station(3, "다"),
				station(4, "라"),
				station(5, "마"),
			],
		},
	],
	line: "seoul-subway:2",
};

const loopLeg: SubwayLeg = {
	alight: { name: "마", stop: "seoul-subway:S5" },
	board: { name: "나", stop: "seoul-subway:S2" },
	direction: "up",
	line: "seoul-subway:2",
	lineName: "2호선",
	mode: "subway",
};

it("subway sheet includes train number and loop direction", () => {
	const model = sheetModel({
		leg: loopLeg,
		map: loopMap,
		nowMs: NOW,
		observedAt: NOW - 5000,
		positionSeq: 4,
		vehicleId: "2231",
		view: emptyView([
			{
				etaAt: NOW + 125_000,
				method: "official",
				stopsAway: 3,
				vehicleId: "2231",
			},
		]),
	});
	expect(model.trainNo).toBe("2231");
	expect(model.directionKey).toBe("map.sheet.direction.subway");
	expect(model.directionParams).toEqual({
		loop: "내선순환",
		name: "마",
	});
	// 이음매를 넘어 승차역까지 이어진다.
	expect(model.stops).toEqual([
		{ name: "다", state: "past" },
		{ name: "라", state: "now" },
		{ name: "마", state: "next" },
		{ name: "가", state: "next" },
		{ name: "나", state: "mine" },
	]);
	expect(model.minutesToMine).toBe(2);
});

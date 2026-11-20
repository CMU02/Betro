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

const busStop = (
	seq: number,
	name: string,
	directionName: string | null = null
) => ({
	arsId: null,
	directionName,
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

it("bus sheet heads toward the stop's own direction on a round-trip route", () => {
	// 왕복 노선은 마지막 정류장이 출발지다. 서울 노선 정보의 정류장별 방면(directionName)을 쓴다.
	const roundTrip: BusMap = {
		...busMap,
		stops: [
			busStop(1, "기점", "반환점"),
			busStop(2, "둘", "반환점"),
			busStop(4, "넷", "반환점"),
			busStop(5, "반환점", "기점"),
			busStop(9, "기점", null),
		],
	};
	const model = sheetModel({
		boarded: false,
		leg: busLeg,
		map: roundTrip,
		nowMs: NOW,
		observedAt: NOW,
		positionSeq: 2,
		vehicleId: "V1",
		view: emptyView([]),
	});
	expect(model.directionParams).toEqual({ name: "반환점" });
});

it("bus sheet lists one past stop, now, next stops and ends at my stop with minutes from approaching", () => {
	const model = sheetModel({
		boarded: false,
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
		boarded: false,
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
		boarded: false,
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
		boarded: false,
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
	line: "seoul-subway:line2",
};

const loopLeg: SubwayLeg = {
	alight: { name: "마", stop: "seoul-subway:S5" },
	board: { name: "나", stop: "seoul-subway:S2" },
	direction: "up",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};

it("subway sheet includes train number and loop direction", () => {
	const model = sheetModel({
		boarded: false,
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

it("a boarded train on a loop ends its stop rows at the alight station", () => {
	// 2호선 본선 10역, 승차 S2, 하차 S6, 지금 S4. 승차역으로 한 바퀴 돌아가지 않는다.
	const names = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
	const map: SubwayMap = {
		...loopMap,
		branches: [
			{
				branchKey: "main",
				direction: "up",
				shape: [],
				stations: names.map((name, seq) => station(seq, name)),
			},
		],
	};
	const leg: SubwayLeg = {
		...loopLeg,
		alight: { name: "육", stop: "seoul-subway:S6" },
		board: { name: "이", stop: "seoul-subway:S2" },
	};
	const input = {
		leg,
		map,
		nowMs: NOW,
		observedAt: NOW,
		positionSeq: 4,
		vehicleId: "2231",
		view: null,
	};
	expect(sheetModel({ ...input, boarded: true }).stops).toEqual([
		{ name: "삼", state: "past" },
		{ name: "사", state: "now" },
		{ name: "오", state: "next" },
		{ name: "육", state: "mine" },
	]);
	// 타기 전이면 이음매를 넘어 승차역까지 이어진다.
	const waiting = sheetModel({ ...input, boarded: false }).stops;
	expect(waiting.at(-1)).toEqual({ name: "이", state: "mine" });
	expect(waiting).toHaveLength(10);
});

it("a split line uses the branch that holds the alight station, like the map", () => {
	// 5호선 하행: 본선(S0~S2)에서 하남 가지와 마천 가지로 갈린다. 하남 가지가 먼저 온다.
	// 가지마다 순번이 0부터라 갈린 뒤의 순번(3, 4)이 두 가지에서 겹친다.
	const branchStation = (seq: number, name: string, stop: string) => ({
		...station(seq, name),
		stop: `seoul-subway:${stop}`,
	});
	const trunk = [
		branchStation(0, "본0", "S0"),
		branchStation(1, "본1", "S1"),
		branchStation(2, "본2", "S2"),
	];
	const map: SubwayMap = {
		batchId: 1,
		branches: [
			{
				branchKey: "hanam",
				direction: "down",
				shape: [],
				stations: [
					...trunk,
					branchStation(3, "하1", "H1"),
					branchStation(4, "하2", "H2"),
				],
			},
			{
				branchKey: "macheon",
				direction: "down",
				shape: [],
				stations: [
					...trunk,
					branchStation(3, "마1", "M1"),
					branchStation(4, "마2", "M2"),
					branchStation(5, "마3", "M3"),
				],
			},
		],
		line: "seoul-subway:line5",
	};
	const leg: SubwayLeg = {
		alight: { name: "마2", stop: "seoul-subway:M2" },
		board: { name: "본1", stop: "seoul-subway:S1" },
		direction: "down",
		line: "seoul-subway:line5",
		lineName: "5호선",
		mode: "subway",
	};
	// 지도는 마천 가지에서 순번을 낸다. 탑승한 열차가 마1에 있다.
	const model = sheetModel({
		boarded: true,
		leg,
		map,
		nowMs: NOW,
		observedAt: NOW,
		positionSeq: 3,
		vehicleId: "5123",
		view: null,
	});
	expect(model.stops).toEqual([
		{ name: "본2", state: "past" },
		{ name: "마1", state: "now" },
		{ name: "마2", state: "mine" },
	]);
	expect(model.directionParams).toEqual({ name: "마3" });
});

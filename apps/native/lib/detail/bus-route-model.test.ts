import { describe, expect, it } from "bun:test";
import type { BusMap, BusSnapshotVehicle } from "@/lib/map/map-client";
import { busRouteModel } from "./bus-route-model";
import type { BusRouteViewResponse } from "./detail-client";

const NOW = Date.UTC(2026, 10, 24, 3, 0);
const LINE = "seoul-bus:100100118";

const stop = (seq: number, directionName: string | null) => ({
	arsId: null,
	directionName,
	lat: 37,
	lng: 127,
	name: `정류장${seq}`,
	seq,
	stop: `seoul-bus:S${seq}`,
});

const map: BusMap = {
	batchId: 1,
	line: LINE,
	shape: [
		[127, 37],
		[127.01, 37],
	],
	stops: [
		stop(1, "강남"),
		stop(2, "강남"),
		stop(3, "강남"),
		stop(4, "신사"),
		stop(5, "신사"),
	],
};

const vehicle = (
	vehId: string,
	sectOrd: number,
	over: Partial<BusSnapshotVehicle> = {}
): BusSnapshotVehicle => ({
	busType: "1",
	lastSeenAt: NOW,
	lat: 37,
	lng: 127,
	observedAt: NOW,
	plainNo: `서울74사${vehId}`,
	routeId: "100100118",
	sectOrd,
	vehId,
	...over,
});

const view = (
	over: Partial<BusRouteViewResponse> = {}
): BusRouteViewResponse => ({
	etaState: "live",
	fetchedAt: NOW,
	headwayMs: 8 * 60_000,
	route: { name: "146", routeType: "3", shortName: "146" },
	stops: [],
	...over,
});

const base = {
	map,
	now: NOW,
	selectedDirection: null,
	selectedSeq: null,
	selectedVehicleId: null,
	vehicles: [] as BusSnapshotVehicle[],
	view: null,
};

describe("busRouteModel", () => {
	it("방향은 directionName이 바뀌는 곳으로 나누고 고른 방향의 정류장만 낸다", () => {
		const model = busRouteModel({ ...base, selectedDirection: "신사" });
		expect(model.directions).toEqual(["강남", "신사"]);
		expect(model.stops.map((entry) => entry.seq)).toEqual([4, 5]);
	});

	it("방면 이름이 없으면 방향 칸을 숨기고 정류장을 모두 낸다", () => {
		const unnamed: BusMap = {
			...map,
			stops: map.stops.map((entry) => ({ ...entry, directionName: null })),
		};
		const model = busRouteModel({ ...base, map: unnamed });
		expect(model.directions).toEqual([]);
		expect(model.stops).toHaveLength(5);
	});

	it("노선 보기가 estimated면 고른 정류장에 배차 약 N분만 둔다", () => {
		const model = busRouteModel({
			...base,
			selectedDirection: "강남",
			selectedSeq: 2,
			view: view({ etaState: "estimated", stops: [] }),
		});
		expect(model.stops.map((entry) => entry.status)).toEqual([
			null,
			{ kind: "estimated", text: "배차 약 8분" },
			null,
		]);
		expect(model.stops.map((entry) => entry.state)).toEqual([
			"passed",
			"current",
			"upcoming",
		]);
	});

	it("live면 정류장마다 가장 가까운 차량의 도착을 낸다", () => {
		const model = busRouteModel({
			...base,
			selectedDirection: "강남",
			selectedSeq: 1,
			view: view({
				stops: [
					{
						seq: 2,
						vehicles: [
							{
								etaAt: NOW + 3 * 60_000,
								plate: "a",
								stopsAway: 1,
								vehicleId: "A",
							},
						],
					},
				],
			}),
		});
		expect(model.stops[1]?.status).toEqual({ kind: "live", text: "3분" });
		expect(model.stops[2]?.status).toBeNull();
	});

	it("고른 차량의 다음 정류장과 도착을 낸다", () => {
		const model = busRouteModel({
			...base,
			selectedVehicleId: "A",
			vehicles: [vehicle("A", 2), vehicle("B", 4)],
			view: view({
				stops: [
					{
						seq: 3,
						vehicles: [
							{
								etaAt: NOW + 120_000,
								plate: "p",
								stopsAway: 1,
								vehicleId: "A",
							},
						],
					},
				],
			}),
		});
		expect(model.selectedVehicle).toEqual({
			lowFloor: true,
			nextStopName: "정류장3",
			plate: "서울74사A",
			status: { kind: "live", text: "2분" },
		});
	});

	it("고른 차량이 스냅샷에 없으면 selectedVehicle은 null이다", () => {
		const model = busRouteModel({
			...base,
			selectedVehicleId: "Z",
			vehicles: [vehicle("A", 2)],
		});
		expect(model.selectedVehicle).toBeNull();
	});

	it("다른 노선 차량은 타임라인에 올리지 않는다", () => {
		const model = busRouteModel({
			...base,
			selectedDirection: "강남",
			vehicles: [vehicle("A", 2), vehicle("X", 3, { routeId: "999" })],
		});
		expect(model.stops.map((entry) => entry.vehicleHere)).toEqual([
			false,
			true,
			false,
		]);
	});

	it("저상이 아니고 번호판이 없는 차량도 낸다", () => {
		const model = busRouteModel({
			...base,
			selectedVehicleId: "A",
			vehicles: [vehicle("A", 5, { busType: "0", plainNo: null })],
		});
		expect(model.selectedVehicle).toEqual({
			lowFloor: false,
			nextStopName: null,
			plate: null,
			status: null,
		});
	});
});

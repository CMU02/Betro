import { describe, expect, it } from "bun:test";

import type { SubwayMap, SubwaySnapshotVehicle } from "@/lib/map/map-client";
import type { TripStops } from "./detail-client";
import {
	TRIP_STALE_MS,
	trainModel,
	trainSubtitle,
	tripStaleTime,
} from "./train-model";

const NOW = 1_000_000_000_000;

const station = (seq: number, id: string) => ({
	lat: 37,
	lng: 127,
	name: `역${id}`,
	nextRunSec: 120,
	offsetM: 0,
	seq,
	stop: `seoul-subway:${id}`,
});

const branch = (
	branchKey: string,
	direction: "up" | "down",
	ids: string[]
): SubwayMap["branches"][number] => ({
	branchKey,
	direction,
	shape: [],
	stations: ids.map((id, index) => station(index + 1, id)),
});

const lineMap = (line: string, branches: SubwayMap["branches"]): SubwayMap => ({
	batchId: 1,
	branches,
	line,
});

const plain = lineMap("seoul-subway:line1", [
	branch("main", "up", ["A", "B", "C"]),
	branch("main", "down", ["C", "B", "A"]),
]);

const forked = lineMap("seoul-subway:line1", [
	branch("main", "down", ["A", "B", "C"]),
	branch("spur", "down", ["A", "B", "X", "Y"]),
]);

const loop = lineMap("seoul-subway:line2", [
	branch("main", "up", ["A", "B", "C"]),
	branch("main", "down", ["C", "B", "A"]),
]);

const train = (
	over: Partial<SubwaySnapshotVehicle> = {}
): SubwaySnapshotVehicle => ({
	destinationStatnId: "C",
	direction: "up",
	express: false,
	lastSeenAt: NOW - 5000,
	lineKey: "line1",
	observedAt: NOW - 5000,
	rawTrainNo: "1234",
	stationDistanceM: null,
	statnId: "B",
	status: "arrive",
	tripId: null,
	...over,
});

const trip: TripStops = {
	direction: "up",
	express: false,
	line: "seoul-subway:line1",
	stops: [
		{
			arriveAt: null,
			departAt: Date.UTC(2026, 10, 24, 3, 0),
			name: "역A",
			stop: "seoul-subway:A",
		},
		{
			arriveAt: Date.UTC(2026, 10, 24, 3, 5),
			departAt: Date.UTC(2026, 10, 24, 3, 6),
			name: "역B",
			stop: "seoul-subway:B",
		},
		{
			arriveAt: Date.UTC(2026, 10, 24, 3, 10),
			departAt: null,
			name: "역C",
			stop: "seoul-subway:C",
		},
	],
	timezone: "Asia/Seoul",
	tripId: 7,
};

const names = { C: "종점" };

describe("trainModel", () => {
	it("tripId가 없으면 지선 역 목록이고 시각이 없다", () => {
		const model = trainModel({
			map: plain,
			now: NOW,
			stationsById: names,
			trip: null,
			vehicle: train(),
		});
		expect(model.hasTimetable).toBe(false);
		expect(model.stops.map((stop) => stop.name)).toEqual(["역A", "역B", "역C"]);
		expect(model.stops.every((stop) => stop.time === null)).toBe(true);
	});

	it("시간표 없는 순환선 열차는 현재 역부터 한 바퀴를 보인다", () => {
		const ring = lineMap("seoul-subway:line2", [
			branch("main", "up", ["A", "B", "C", "D", "E"]),
		]);
		const model = trainModel({
			map: ring,
			now: NOW,
			stationsById: names,
			trip: null,
			vehicle: train({ lineKey: "line2", statnId: "D" }),
		});
		expect(model.stops.map((stop) => stop.name)).toEqual([
			"역D",
			"역E",
			"역A",
			"역B",
			"역C",
		]);
		expect(model.stops[0]?.state).toBe("current");
		expect(model.nextStopName).toBe("역E");
	});

	it("현재 역 앞은 passed, 뒤는 upcoming이다", () => {
		const model = trainModel({
			map: plain,
			now: NOW,
			stationsById: names,
			trip,
			vehicle: train(),
		});
		expect(model.hasTimetable).toBe(true);
		expect(model.stops.map((stop) => stop.state)).toEqual([
			"passed",
			"current",
			"upcoming",
		]);
		expect(model.nextStopName).toBe("역C");
		expect(model.stops.map((stop) => stop.time)).toEqual([
			"12:00",
			"12:05",
			"12:10",
		]);
		expect(model.destinationName).toBe("종점");
	});

	it("차량이 사라지면 freshness가 null이다", () => {
		const model = trainModel({
			map: plain,
			now: NOW,
			stationsById: names,
			trip,
			vehicle: null,
		});
		expect(model.freshness).toBeNull();
		expect(model.stops.every((stop) => stop.state === "upcoming")).toBe(true);
		expect(model.nextStopName).toBeNull();
	});

	it("관측이 최근이면 live이고 오래되면 아니다", () => {
		const fresh = trainModel({
			map: plain,
			now: NOW,
			stationsById: names,
			trip: null,
			vehicle: train(),
		});
		expect(fresh.freshness).toEqual({ live: true, secondsAgo: 5 });
		const old = trainModel({
			map: plain,
			now: NOW,
			stationsById: names,
			trip: null,
			vehicle: train({ observedAt: NOW - 600_000 }),
		});
		expect(old.freshness).toEqual({ live: false, secondsAgo: 600 });
	});

	it("갈라지는 노선은 열차가 지나는 지선의 역만 보인다", () => {
		const model = trainModel({
			map: forked,
			now: NOW,
			stationsById: {},
			trip: null,
			vehicle: train({ direction: "down", statnId: "X" }),
		});
		expect(model.stops.map((stop) => stop.name)).toEqual([
			"역A",
			"역B",
			"역X",
			"역Y",
		]);
		expect(model.stops.map((stop) => stop.state)).toEqual([
			"passed",
			"passed",
			"current",
			"upcoming",
		]);
	});

	it("차량도 trip도 없으면 정차 목록이 비어 있다", () => {
		const model = trainModel({
			map: plain,
			now: NOW,
			stationsById: names,
			trip: null,
			vehicle: null,
		});
		expect(model.stops).toEqual([]);
		expect(model.hasTimetable).toBe(false);
	});

	it("2호선은 directionLabel이 내선순환·외선순환이다", () => {
		const inner = trainModel({
			map: loop,
			now: NOW,
			stationsById: {},
			trip: null,
			vehicle: train({ direction: "up", lineKey: "line2" }),
		});
		expect(inner.directionLabel).toBe("내선순환");
		const outer = trainModel({
			map: loop,
			now: NOW,
			stationsById: {},
			trip: null,
			vehicle: train({
				direction: "down",
				lineKey: "line2",
				statnId: "B",
			}),
		});
		expect(outer.directionLabel).toBe("외선순환");
	});

	it("순환선이 아니면 상행·하행이다", () => {
		const model = trainModel({
			map: plain,
			now: NOW,
			stationsById: names,
			trip: null,
			vehicle: train({ direction: "down", statnId: "B" }),
		});
		expect(model.directionLabel).toBe("하행");
	});
});

describe("trainSubtitle", () => {
	it("목적지가 있으면 행과 방향을 잇고 없으면 방향만 쓴다", () => {
		const base = {
			destinationName: "종점",
			directionLabel: "상행",
			express: false,
			freshness: null,
			hasTimetable: false,
			nextStopName: null,
			stops: [],
		};
		expect(trainSubtitle(base)).toBe("종점행 · 상행");
		expect(trainSubtitle({ ...base, destinationName: null })).toBe("상행");
		expect(
			trainSubtitle({ ...base, destinationName: null, directionLabel: null })
		).toBeNull();
	});
});

describe("tripStaleTime", () => {
	it("keeps a found or not-found trip fresh for the trip window", () => {
		expect(tripStaleTime({ state: { data: { ok: true } } })).toBe(
			TRIP_STALE_MS
		);
		expect(
			tripStaleTime({ state: { data: { ok: false, reason: "not-found" } } })
		).toBe(TRIP_STALE_MS);
	});

	it.each(["offline", "unavailable", "invalid"])(
		"treats a %s failure as stale right away",
		(reason) => {
			expect(tripStaleTime({ state: { data: { ok: false, reason } } })).toBe(0);
		}
	);

	it("treats a query with no data yet as stale", () => {
		expect(tripStaleTime({ state: { data: undefined } })).toBe(0);
	});
});

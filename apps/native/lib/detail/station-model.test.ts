import { describe, expect, it } from "bun:test";

import type { SubwayMap } from "@/lib/map/map-client";
import type { StationView, StationViewDirection } from "./detail-client";
import { stationModel } from "./station-model";

const NOW = Date.UTC(2026, 10, 24, 0, 0);
const MIN = 60_000;

const station = (name: string, stop: string, seq: number) => ({
	lat: 37,
	lng: 127,
	name,
	nextRunSec: null,
	offsetM: seq * 1000,
	seq,
	stop: `seoul-subway:${stop}`,
});

const MAPS: Record<string, SubwayMap> = {
	"seoul-subway:line2": {
		batchId: 1,
		branches: [
			{
				branchKey: "main",
				direction: "up",
				shape: [],
				stations: [
					station("교대", "s1", 0),
					station("강남", "s2", 1),
					station("역삼", "s3", 2),
				],
			},
			{
				branchKey: "main",
				direction: "down",
				shape: [],
				stations: [
					station("역삼", "s3", 0),
					station("강남", "s2", 1),
					station("교대", "s1", 2),
				],
			},
		],
		line: "seoul-subway:line2",
	},
	"seoul-subway:line4": {
		batchId: 1,
		branches: [
			{
				branchKey: "a",
				direction: "up",
				shape: [],
				stations: [
					station("사당", "t1", 0),
					station("이수", "t2", 1),
					station("당고개", "t3", 2),
				],
			},
			{
				branchKey: "b",
				direction: "up",
				shape: [],
				stations: [
					station("사당", "t1", 0),
					station("이수", "t2", 1),
					station("오이도", "t9", 2),
				],
			},
		],
		line: "seoul-subway:line4",
	},
};

function direction(
	dir: "up" | "down",
	over: Partial<StationViewDirection> = {}
): StationViewDirection {
	return {
		approaching: [
			{
				etaAt: NOW + 3 * MIN,
				method: "timetable",
				stopsAway: null,
				vehicleId: "timetable:1",
			},
			{
				etaAt: NOW + 9 * MIN,
				method: "timetable",
				stopsAway: null,
				vehicleId: "timetable:2",
			},
			{
				etaAt: NOW + 15 * MIN,
				method: "timetable",
				stopsAway: null,
				vehicleId: "timetable:3",
			},
		],
		direction: dir,
		etaState: "estimated",
		firstAt: null,
		headwayMs: null,
		lastAt: null,
		...over,
	};
}

function view(
	line: string,
	stop: string,
	directions: StationViewDirection[],
	timezone = "UTC"
): StationView {
	return {
		generatedAt: NOW,
		stations: [{ directions, line, stop }],
		timezone,
	};
}

const estimatedOnlyView = view("seoul-subway:line2", "seoul-subway:s2", [
	direction("up"),
	direction("down"),
]);

describe("stationModel", () => {
	it("두 방향 모두 시간표뿐이면 행마다 시간표 추정이다", () => {
		const [line] = stationModel(estimatedOnlyView, MAPS, NOW);
		expect(
			line?.directions.flatMap((d) => d.rows.map((r) => r.status.kind))
		).toEqual(["estimated", "estimated", "estimated", "estimated"]);
	});

	it("방향마다 두 줄까지만 낸다", () => {
		const [line] = stationModel(estimatedOnlyView, MAPS, NOW);
		expect(line?.directions.map((d) => d.rows.length)).toEqual([2, 2]);
	});

	it("2호선 강남역 up 방향은 '내선순환 · {강남 다음 역} 방면'이다", () => {
		const [line] = stationModel(estimatedOnlyView, MAPS, NOW);
		expect(line?.directions[0]?.directionLabel).toBe("내선순환 · 역삼 방면");
		expect(line?.directions[1]?.directionLabel).toBe("외선순환 · 교대 방면");
	});

	it("갈라지는 노선은 이 역을 지나는 가지의 끝 역을 방면으로 쓴다", () => {
		const forked = view("seoul-subway:line4", "seoul-subway:t9", [
			direction("up"),
		]);
		const [line] = stationModel(forked, MAPS, NOW);
		expect(line?.directions[0]?.directionLabel).toBe("오이도 방면");
		const trunk = view("seoul-subway:line4", "seoul-subway:t2", [
			direction("up"),
		]);
		expect(
			stationModel(trunk, MAPS, NOW)[0]?.directions[0]?.directionLabel
		).toBe("당고개 방면");
	});

	it("첫차·막차는 응답의 timezone으로 그린다", () => {
		const tokyo = view(
			"seoul-subway:line4",
			"seoul-subway:t1",
			[
				direction("up", {
					firstAt: Date.UTC(2026, 10, 24, 20, 30),
					lastAt: Date.UTC(2026, 10, 24, 14, 5),
				}),
			],
			"Asia/Tokyo"
		);
		const row = stationModel(tokyo, MAPS, NOW)[0]?.directions[0];
		expect(row?.firstLabel).toBe("05:30");
		expect(row?.lastLabel).toBe("23:05");
	});

	it("열차 번호가 있는 행만 trainNo를 갖고 시간표 차량은 null이다", () => {
		const live = view("seoul-subway:line2", "seoul-subway:s2", [
			direction("up", {
				approaching: [
					{
						etaAt: NOW + 2 * MIN,
						method: null,
						stopsAway: 1,
						vehicleId: "2401",
					},
					{
						etaAt: NOW + 8 * MIN,
						method: "timetable",
						stopsAway: null,
						vehicleId: "timetable:7",
					},
				],
				etaState: "live",
			}),
		]);
		const rows = stationModel(live, MAPS, NOW)[0]?.directions[0]?.rows;
		expect(rows?.map((r) => r.trainNo)).toEqual(["2401", null]);
		expect(rows?.map((r) => r.status.kind)).toEqual(["live", "estimated"]);
	});

	it("지도를 아직 못 받았으면 방면 대신 상행·하행으로 보이고 행은 낸다", () => {
		const [line] = stationModel(estimatedOnlyView, {}, NOW);
		expect(line?.directions).toHaveLength(2);
		expect(line?.directions.map((d) => [d.key, d.directionLabel])).toEqual(
			line?.directions.map((d) => [d.key, d.key === "up" ? "상행" : "하행"])
		);
	});

	it("방면 이름이 비어도 방향 key가 겹치지 않고, 같은 분의 시간표 행도 key가 겹치지 않는다", () => {
		const [line] = stationModel(estimatedOnlyView, {}, NOW);
		const directionKeys = line?.directions.map((d) => d.key) ?? [];
		expect(new Set(directionKeys).size).toBe(2);
		const sameMinute = view("seoul-subway:line2", "seoul-subway:s2", [
			direction("up", {
				approaching: [
					{
						etaAt: NOW + 3 * MIN,
						method: "timetable",
						stopsAway: null,
						vehicleId: "timetable:7",
					},
					{
						etaAt: NOW + 3 * MIN,
						method: "timetable",
						stopsAway: null,
						vehicleId: "timetable:8",
					},
				],
				etaState: "estimated",
			}),
		]);
		const rowKeys =
			stationModel(sameMinute, {}, NOW)[0]?.directions[0]?.rows.map(
				(r) => r.key
			) ?? [];
		expect(new Set(rowKeys).size).toBe(2);
	});
});

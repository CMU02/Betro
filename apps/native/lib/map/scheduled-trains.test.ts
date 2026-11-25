import type { SubwayLeg } from "@Betro/commute/plan";
import { describe, expect, it } from "bun:test";
import type { ServerClient, ServerResponse } from "@/lib/server/api-client";

import type { SubwayMap } from "./map-client";
import { createSubwayTrack } from "./motion";
import {
	fetchScheduledTrains,
	type ScheduledTrain,
	scheduledVehicles,
} from "./scheduled-trains";

const GENERATED_AT = 5_000_000;
const LAT = 37.5;
const LNG_STEP = 0.01;

function stationsOf(stops: readonly string[]) {
	return stops.map((stop, index) => ({
		lat: LAT,
		lng: 127 + index * LNG_STEP,
		name: stop,
		nextRunSec: 120,
		offsetM: 0,
		seq: index,
		stop: `seoul-subway:${stop}`,
	}));
}

/** 동쪽으로 곧게 뻗은 선로. 위 방향은 S0→S3, 아래 방향은 S3→S0이다. */
const straightMap: SubwayMap = {
	batchId: 1,
	branches: [
		{
			branchKey: "main",
			direction: "up",
			shape: [
				[127, LAT],
				[127 + 3 * LNG_STEP, LAT],
			],
			stations: stationsOf(["S0", "S1", "S2", "S3"]),
		},
		{
			branchKey: "main",
			direction: "down",
			shape: [
				[127 + 3 * LNG_STEP, LAT],
				[127, LAT],
			],
			stations: stationsOf(["S3", "S2", "S1", "S0"]).map((station, seq) => ({
				...station,
				lng: 127 + (3 - seq) * LNG_STEP,
			})),
		},
	],
	line: "seoul-subway:line5",
};

const straightLeg: SubwayLeg = {
	alight: { name: "S3", stop: "seoul-subway:S3" },
	board: { name: "S2", stop: "seoul-subway:S2" },
	direction: "up",
	line: "seoul-subway:line5",
	lineName: "5호선",
	mode: "subway",
};

function train(
	tripId: number,
	fromStop: string,
	toStop: string,
	progress: number,
	direction: "up" | "down" = "up"
): ScheduledTrain {
	return {
		direction,
		fromStop: `seoul-subway:${fromStop}`,
		progress,
		toStop: `seoul-subway:${toStop}`,
		trainNo: `T${tripId}`,
		tripId,
	};
}

describe("scheduledVehicles", () => {
	it("scheduledVehicles는 두 역의 선로 거리 사이에 놓이고 estimated다", () => {
		const [vehicle] = scheduledVehicles(
			[train(7, "S0", "S1", 0.5)],
			straightLeg,
			straightMap,
			2,
			GENERATED_AT
		);
		const track = createSubwayTrack(
			straightMap.branches[0] as SubwayMap["branches"][number]
		);
		const from = track?.stations[0]?.distanceM ?? Number.NaN;
		const to = track?.stations[1]?.distanceM ?? Number.NaN;
		expect(vehicle?.id).toBe("scheduled:7");
		expect(vehicle?.estimated).toBe(true);
		expect(vehicle?.kind).toBe("subway");
		expect(vehicle?.legIndex).toBe(2);
		expect(vehicle?.observedAt).toBe(GENERATED_AT);
		expect(vehicle?.lastSeenAt).toBe(GENERATED_AT);
		expect(vehicle?.positionSeq).toBe(0);
		expect(vehicle?.statnId).toBe("S0");
		expect(vehicle?.motion.observedDistanceM).toBeCloseTo((from + to) / 2, 3);
		// 움직임 없이 그 지점에 멈춰 있다.
		expect(vehicle?.motion.speedMps).toBe(0);
		expect(vehicle?.motion.shownDistanceM).toBe(
			vehicle?.motion.observedDistanceM ?? Number.NaN
		);
		expect(vehicle?.longitude).toBeCloseTo(127 + LNG_STEP / 2, 4);
		expect(vehicle?.observedPosition.longitude).toBeCloseTo(
			127 + LNG_STEP / 2,
			4
		);
	});

	it("scheduledVehicles는 반대 방향과 승차역을 지난 열차를 그리지 않는다", () => {
		const vehicles = scheduledVehicles(
			[
				train(1, "S1", "S2", 0.9),
				train(2, "S1", "S0", 0.5, "down"),
				train(3, "S2", "S3", 0.1),
				// 이 가지에 없는 역 사이의 열차(다른 가지)는 놓을 자리가 없다.
				train(4, "S1", "X9", 0.5),
			],
			straightLeg,
			straightMap,
			0,
			GENERATED_AT
		);
		expect(vehicles.map((vehicle) => vehicle.id)).toEqual(["scheduled:1"]);
	});

	it("순환선은 승차역 뒤 반 바퀴 안의 열차만, 이음매 구간은 앞 역에 둔다", () => {
		const ring = ["L0", "L1", "L2", "L3", "L4", "L5"];
		const loopMap: SubwayMap = {
			batchId: 1,
			branches: [
				{
					branchKey: "main",
					direction: "up",
					shape: [
						[127, LAT],
						[127 + 5 * LNG_STEP, LAT],
					],
					stations: stationsOf(ring),
				},
			],
			line: "seoul-subway:line2",
		};
		const leg: SubwayLeg = {
			alight: { name: "L2", stop: "seoul-subway:L2" },
			board: { name: "L1", stop: "seoul-subway:L1" },
			direction: "up",
			line: "seoul-subway:line2",
			lineName: "2호선",
			mode: "subway",
		};
		const vehicles = scheduledVehicles(
			[
				train(1, "L5", "L0", 0.5),
				train(2, "L0", "L1", 0.5),
				train(3, "L2", "L3", 0.5),
			],
			leg,
			loopMap,
			0,
			GENERATED_AT
		);
		expect(vehicles.map((vehicle) => vehicle.id)).toEqual([
			"scheduled:1",
			"scheduled:2",
		]);
		const track = createSubwayTrack(
			loopMap.branches[0] as SubwayMap["branches"][number]
		);
		// 마지막 역에서 첫 역으로 넘어가는 구간은 거꾸로 보간하지 않는다.
		expect(vehicles[0]?.motion.observedDistanceM).toBeCloseTo(
			track?.stations[5]?.distanceM ?? Number.NaN,
			3
		);
	});
});

describe("fetchScheduledTrains", () => {
	function fakeClient(response: ServerResponse) {
		const paths: string[] = [];
		const client: ServerClient = {
			request: (_method, path) => {
				paths.push(path);
				return Promise.resolve(response);
			},
		};
		return { client, paths };
	}

	it("노선 키로 받고 응답을 읽는다", async () => {
		const body = {
			generatedAt: GENERATED_AT,
			trains: [train(7, "S0", "S1", 0.5)],
		};
		const { client, paths } = fakeClient({ json: body, status: 200 });
		const result = await fetchScheduledTrains(client, "seoul-subway:line5");
		expect(paths).toEqual(["/v1/map/scheduled/line5"]);
		expect(result).toEqual({ ok: true, value: body });
	});

	it("503은 unavailable이다", async () => {
		const { client } = fakeClient({ json: null, status: 503 });
		expect(await fetchScheduledTrains(client, "line5")).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});
});

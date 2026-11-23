import { describe, expect, it } from "bun:test";
import { dropFrozen, FROZEN_VEHICLE_MS, updateSeen } from "./frozen";
import type { RouteStopArrival } from "./seoul-bus";

const T0 = Date.UTC(2026, 10, 23, 3, 0);

function veh(vehicleId: string, seqNow: number, etaSec: number) {
	return {
		etaSec,
		isArrived: false,
		lastOfDay: false,
		plate: "",
		seqNow,
		vehicleId,
	};
}

function stop15(vehicles: ReturnType<typeof veh>[]): RouteStopArrival {
	return { headwayMin: null, madeAt: T0, seq: 15, stopId: "s15", vehicles };
}

describe("멈춘 차량", () => {
	it("예측 초가 흔들려도 순번이 5분 넘게 그대로인 차량은 빠지고 다음 차량이 남는다", () => {
		let seen = updateSeen(
			{},
			[stop15([veh("A", 12, 491), veh("B", 8, 734)])],
			T0
		);
		const later = [stop15([veh("A", 12, 507), veh("B", 9, 650)])];
		seen = updateSeen(seen, later, T0 + FROZEN_VEHICLE_MS + 1000);
		const kept = dropFrozen(later, seen, T0 + FROZEN_VEHICLE_MS + 1000);
		expect(kept[0]?.vehicles.map((x) => x.vehicleId)).toEqual(["B"]);
	});

	it("5분 안에서는 같은 순번이어도 남긴다", () => {
		const first = [stop15([veh("A", 12, 491)])];
		const seen = updateSeen({}, first, T0);
		const second = [stop15([veh("A", 12, 500)])];
		const next = updateSeen(seen, second, T0 + 200_000);
		expect(dropFrozen(second, next, T0 + 200_000)[0]?.vehicles).toHaveLength(1);
	});

	it("순번이 바뀌면 변화 시각이 새로 잡힌다", () => {
		const seen = updateSeen(
			{ A: { seqNow: 12, since: T0 } },
			[stop15([veh("A", 13, 400)])],
			T0 + 400_000
		);
		expect(seen.A).toEqual({ seqNow: 13, since: T0 + 400_000 });
	});

	it("처음 보는 차량은 지금 시각부터 센다", () => {
		const seen = updateSeen({}, [stop15([veh("A", 12, 491)])], T0);
		expect(seen.A).toEqual({ seqNow: 12, since: T0 });
	});
});

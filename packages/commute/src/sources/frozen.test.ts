import { describe, expect, it } from "bun:test";
import {
	dropFrozen,
	dropFrozenPositions,
	FROZEN_VEHICLE_MS,
	updateSeen,
} from "./frozen";
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
		expect(seen.A).toEqual({
			lastSeen: T0 + 400_000,
			seqNow: 13,
			since: T0 + 400_000,
		});
	});

	it("처음 보는 차량은 지금 시각부터 센다", () => {
		const seen = updateSeen({}, [stop15([veh("A", 12, 491)])], T0);
		expect(seen.A).toEqual({ lastSeen: T0, seqNow: 12, since: T0 });
	});

	it("한 poll 빠졌다가 같은 순번으로 다시 나온 차량은 처음 본 시각을 이어 센다", () => {
		let seen = updateSeen({}, [stop15([veh("A", 12, 491)])], T0);
		// 이미 걸러진 직전 도착을 둔 poll처럼, A가 한 번 빠진다.
		seen = updateSeen(seen, [stop15([])], T0 + 120_000);
		const later = [stop15([veh("A", 12, 500)])];
		const at = T0 + FROZEN_VEHICLE_MS + 1000;
		seen = updateSeen(seen, later, at);
		expect(seen.A).toMatchObject({ since: T0 });
		expect(dropFrozen(later, seen, at)[0]?.vehicles).toEqual([]);
	});

	it("마지막으로 본 지 FROZEN_VEHICLE_MS가 지난 기록은 버린다", () => {
		const seen = updateSeen(
			{ A: { lastSeen: T0, seqNow: 12, since: T0 } },
			[stop15([])],
			T0 + FROZEN_VEHICLE_MS + 1000
		);
		expect(seen.A).toBeUndefined();
	});

	it("lastSeen이 없는 이전 기록은 지금 본 것으로 보고 이어 둔다", () => {
		const seen = updateSeen(
			{ A: { seqNow: 12, since: T0 } },
			[stop15([])],
			T0 + FROZEN_VEHICLE_MS + 1000
		);
		expect(seen.A).toEqual({
			lastSeen: T0 + FROZEN_VEHICLE_MS + 1000,
			seqNow: 12,
			since: T0,
		});
	});

	it("위치 목록에서만 보이는 차량도 순번이 5분 넘게 그대로면 위치에서 뺀다", () => {
		let seen = updateSeen({}, [], T0, { A: 12, B: 8 });
		const at = T0 + FROZEN_VEHICLE_MS + 1000;
		seen = updateSeen(seen, [], at, { A: 12, B: 9 });
		expect(dropFrozenPositions({ A: 12, B: 9 }, seen, at)).toEqual({ B: 9 });
	});

	it("이어 쓴 위치(이번에 받지 않은 위치)는 기록을 새로 하지 않는다", () => {
		let seen = updateSeen({}, [], T0, { A: 12 });
		// 위치 목록을 못 읽은 poll은 위치를 관측으로 넘기지 않는다.
		seen = updateSeen(seen, [], T0 + 120_000);
		expect(seen["pos:A"]).toEqual({ lastSeen: T0, seqNow: 12, since: T0 });
	});

	it("도착의 순번과 위치 목록의 순번은 따로 센다", () => {
		let seen = updateSeen({}, [stop15([veh("A", 12, 491)])], T0, { A: 13 });
		const at = T0 + FROZEN_VEHICLE_MS + 1000;
		const later = [stop15([veh("A", 12, 500)])];
		seen = updateSeen(seen, later, at, { A: 13 });
		// 서로 한 정거장 달라도 매 poll 변화로 보지 않는다.
		expect(dropFrozen(later, seen, at)[0]?.vehicles).toEqual([]);
		expect(dropFrozenPositions({ A: 13 }, seen, at)).toEqual({});
	});

	it("tago-pos: 차량은 poll마다 다른 차량일 수 있어 빠지면 바로 버린다", () => {
		const seen = updateSeen(
			{ "tago-pos:12": { lastSeen: T0, seqNow: 12, since: T0 } },
			[stop15([])],
			T0 + 60_000
		);
		expect(seen["tago-pos:12"]).toBeUndefined();
	});
});

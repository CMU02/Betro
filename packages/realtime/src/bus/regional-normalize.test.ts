import { describe, expect, it } from "bun:test";
import type { BusRouteRef } from "../reference";
import type { RegionalPositionRow } from "../upstream/regional-position";
import {
	normalizeRegionalPositions,
	REGIONAL_FROZEN_MS,
	type RegionalPrev,
} from "./regional-normalize";

const ref: BusRouteRef = {
	coords: [
		[127.0, 37.0],
		[127.0, 37.01],
		[127.0, 37.02],
	],
	lengthM: 2224,
	routeId: "1",
	segmentsBySeq: new Map([
		[1, { endM: 1112, fromSeq: 1, startM: 0 }],
		[2, { endM: 2224, fromSeq: 2, startM: 1112 }],
	]),
};

const gbisRow = (seq: number): RegionalPositionRow => ({
	lat: null,
	lng: null,
	plate: "경기70가1234",
	seq,
	vehId: "v1",
});

const T0 = 1_700_000_000_000;

describe("normalizeRegionalPositions", () => {
	it("GBIS 차량은 정류장 구간 시작 거리의 노선 좌표에 놓이고 position-from-stop이다", () => {
		const { observations } = normalizeRegionalPositions(
			"gbis:1",
			"gbis",
			[gbisRow(1)],
			ref,
			new Map(),
			T0
		);
		expect(observations).toHaveLength(1);
		const [o] = observations;
		expect(o?.routeId).toBe("gbis:1");
		expect(o?.lat).toBeCloseTo(37.0, 5);
		expect(o?.lng).toBeCloseTo(127.0, 5);
		expect(o?.qualityFlags).toEqual(
			expect.arrayContaining(["position-from-stop", "no-source-time"])
		);
		expect(o?.sectOrd).toBe(1);
		expect(o?.shapeDistanceM).toBe(0);
		expect(o?.sourceAt).toBe(T0);
		expect(o?.plainNo).toBe("경기70가1234");
	});

	it("순번이 5분 넘게 그대로인 차량은 빠지고 prev에는 남는다", () => {
		const prev = new Map<string, RegionalPrev>([
			["v1", { lat: null, lng: null, seq: 2, since: T0 }],
		]);
		const out = normalizeRegionalPositions(
			"gbis:1",
			"gbis",
			[gbisRow(2)],
			ref,
			prev,
			T0 + REGIONAL_FROZEN_MS + 1000
		);
		expect(out.observations).toHaveLength(0);
		expect(out.prev.get("v1")?.since).toBe(T0);
	});

	it("순번이 바뀌면 since가 새로워져 남는다", () => {
		const prev = new Map<string, RegionalPrev>([
			["v1", { lat: null, lng: null, seq: 1, since: T0 }],
		]);
		const now = T0 + REGIONAL_FROZEN_MS + 1000;
		const out = normalizeRegionalPositions(
			"gbis:1",
			"gbis",
			[gbisRow(2)],
			ref,
			prev,
			now
		);
		expect(out.observations).toHaveLength(1);
		expect(out.observations[0]?.sourceAt).toBe(now);
		expect(out.prev.get("v1")?.since).toBe(now);
	});

	it("TAGO는 받은 좌표를 쓰고 좌표만 변해서는 since를 갱신하지 않는다", () => {
		const prev = new Map<string, RegionalPrev>([
			["v1", { lat: 37.0, lng: 127.0, seq: 2, since: T0 }],
		]);
		const row: RegionalPositionRow = {
			lat: 37.005,
			lng: 127.001,
			plate: "인천70사1",
			seq: 2,
			vehId: "v1",
		};
		const fresh = normalizeRegionalPositions(
			"tago:1",
			"tago",
			[row],
			ref,
			prev,
			T0 + 60_000
		);
		expect(fresh.observations[0]?.lat).toBe(37.005);
		expect(fresh.observations[0]?.gpsProjectedDistanceM).toBeNull();
		expect(fresh.observations[0]?.qualityFlags).not.toContain(
			"position-from-stop"
		);
		const frozen = normalizeRegionalPositions(
			"tago:1",
			"tago",
			[row],
			ref,
			prev,
			T0 + REGIONAL_FROZEN_MS + 1000
		);
		expect(frozen.observations).toHaveLength(0);
	});

	it("좌표를 구하지 못하는 차량은 뺀다", () => {
		const noShape: BusRouteRef = { ...ref, coords: undefined };
		const out = normalizeRegionalPositions(
			"gbis:1",
			"gbis",
			[gbisRow(1)],
			noShape,
			new Map(),
			T0
		);
		expect(out.observations).toHaveLength(0);
	});
});

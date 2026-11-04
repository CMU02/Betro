import { describe, expect, it } from "bun:test";
import type { BusObservation, SubwayObservation } from "./observation";
import { BUS_TTL_MS, LatestState, SUBWAY_TTL_MS } from "./state";

const T = 1_793_678_684_100;
const SECOND_MS = 1000;

function subway(overrides: Partial<SubwayObservation> = {}): SubwayObservation {
	return {
		destinationStatnId: "1002000201",
		direction: "down",
		express: false,
		lastTrain: false,
		lineKey: "line2",
		matchStatus: "matched",
		observedAt: T,
		qualityFlags: [],
		rawTrainNo: "2234",
		source: "arrival-all",
		sourceAt: T - 10 * SECOND_MS,
		sourceAtKind: "generated",
		sourceAtRaw: "2026-11-03 12:58:00",
		stationDistanceM: 1200,
		statnId: "1002000222",
		status: "approach",
		trackShapeId: 1,
		tripId: 42,
		...overrides,
	};
}

function bus(overrides: Partial<BusObservation> = {}): BusObservation {
	return {
		busType: "1",
		congestion: "3",
		gpsProjectedDistanceM: 1210,
		lastTrip: false,
		lat: 37.5,
		lng: 127,
		observedAt: T,
		plainNo: "서울74사1234",
		qualityFlags: [],
		routeId: "100100290",
		sectOrd: 4,
		shapeDistanceM: 1213,
		sourceAt: T - 5 * SECOND_MS,
		sourceAtRaw: "20261103125839",
		stopped: false,
		vehId: "111033115",
		...overrides,
	};
}

describe("LatestState", () => {
	it("emits transitions only on change", () => {
		const state = new LatestState();
		const first = state.applySubway([subway()], T);
		expect(first).toHaveLength(1);

		const again = state.applySubway(
			[subway({ observedAt: T + 20 * SECOND_MS })],
			T + 20 * SECOND_MS
		);
		expect(again).toHaveLength(0);

		const changed = state.applySubway(
			[subway({ observedAt: T + 40 * SECOND_MS, status: "arrive" })],
			T + 40 * SECOND_MS
		);
		expect(changed).toHaveLength(1);
		expect(changed[0]?.status).toBe("arrive");

		const moved = state.applySubway(
			[
				subway({
					observedAt: T + 60 * SECOND_MS,
					statnId: "1002000223",
					status: "arrive",
				}),
			],
			T + 60 * SECOND_MS
		);
		expect(moved).toHaveLength(1);
	});

	it("keys trains by line and raw train number", () => {
		const state = new LatestState();
		state.applySubway([subway()], T);
		const other = state.applySubway(
			[subway(), subway({ lineKey: "line7" }), subway({ rawTrainNo: "2236" })],
			T + 20 * SECOND_MS
		);
		expect(other.map((o) => `${o.lineKey}|${o.rawTrainNo}`)).toEqual([
			"line7|2234",
			"line2|2236",
		]);
	});

	it("keeps the latest observation even without a transition", () => {
		const state = new LatestState();
		state.applySubway([subway()], T);
		const later = T + 20 * SECOND_MS;
		state.applySubway(
			[subway({ observedAt: later, sourceAt: later - SECOND_MS })],
			later
		);
		const snap = state.snapshot("subway", later);
		expect(snap.vehicles).toHaveLength(1);
		expect(snap.vehicles[0]?.observedAt).toBe(later);
		expect(snap.vehicles[0]?.sourceAt).toBe(later - SECOND_MS);
		expect(snap.vehicles[0]?.lastSeenAt).toBe(later);
	});

	it("restores from saved state without re-emitting", () => {
		const state = new LatestState();
		state.applySubway([subway()], T);
		state.applyBus("100100290", [bus()], T);
		const saved = JSON.parse(JSON.stringify(state.save()));

		const restored = new LatestState(saved);
		expect(
			restored.applySubway(
				[subway({ observedAt: T + 20 * SECOND_MS })],
				T + 20 * SECOND_MS
			)
		).toHaveLength(0);
		expect(
			restored.applyBus(
				"100100290",
				[bus({ observedAt: T + 20 * SECOND_MS })],
				T + 20 * SECOND_MS
			)
		).toHaveLength(0);
		expect(
			restored.snapshot("subway", T + 20 * SECOND_MS).vehicles
		).toHaveLength(1);
	});

	it("ignores saved state of another version", () => {
		const restored = new LatestState({
			version: 999,
		} as unknown as ConstructorParameters<typeof LatestState>[0]);
		expect(restored.applySubway([subway()], T)).toHaveLength(1);
	});

	it("keeps vehicles through a brief empty response", () => {
		const state = new LatestState();
		state.applySubway([subway()], T);
		state.markSourceEmpty("subway", T + 60 * SECOND_MS);

		const snap = state.snapshot("subway", T + 60 * SECOND_MS);
		expect(snap.vehicles).toHaveLength(1);
		expect(snap.vehicles[0]?.rawTrainNo).toBe("2234");
		expect(snap.staleSince).toBe(T + 60 * SECOND_MS);

		state.markSourceEmpty("subway", T + 80 * SECOND_MS);
		expect(state.snapshot("subway", T + 80 * SECOND_MS).staleSince).toBe(
			T + 60 * SECOND_MS
		);

		state.expire(T + 301 * SECOND_MS);
		expect(state.snapshot("subway", T + 301 * SECOND_MS).vehicles).toHaveLength(
			0
		);
	});

	it("clears staleSince when the source returns", () => {
		const state = new LatestState();
		state.applySubway([subway()], T);
		state.markSourceEmpty("subway", T + 20 * SECOND_MS);
		state.applySubway(
			[subway({ observedAt: T + 40 * SECOND_MS })],
			T + 40 * SECOND_MS
		);
		expect(state.snapshot("subway", T + 40 * SECOND_MS).staleSince).toBeNull();
	});

	it("keeps trains missing from a partial response until the TTL", () => {
		const state = new LatestState();
		state.applySubway([subway(), subway({ rawTrainNo: "2236" })], T);
		const later = T + 200 * SECOND_MS;
		state.applySubway([subway({ observedAt: later })], later);
		state.expire(later);
		expect(state.snapshot("subway", later).vehicles).toHaveLength(2);

		const past = T + SUBWAY_TTL_MS + SECOND_MS;
		state.expire(past);
		const snap = state.snapshot("subway", past);
		expect(snap.vehicles.map((v) => v.rawTrainNo)).toEqual(["2234"]);
		expect(snap.staleSince).toBeNull();
	});

	it("re-emits a train that reappears after expiring", () => {
		const state = new LatestState();
		state.applySubway([subway()], T);
		const past = T + SUBWAY_TTL_MS + SECOND_MS;
		state.expire(past);
		expect(
			state.applySubway([subway({ observedAt: past })], past)
		).toHaveLength(1);
	});

	it("bus emits only new dataTm", () => {
		const state = new LatestState();
		expect(state.applyBus("100100290", [bus()], T)).toHaveLength(1);
		expect(
			state.applyBus(
				"100100290",
				[bus({ observedAt: T + 15 * SECOND_MS })],
				T + 15 * SECOND_MS
			)
		).toHaveLength(0);
		const newer = state.applyBus(
			"100100290",
			[bus({ observedAt: T + 30 * SECOND_MS, sourceAt: T + 25 * SECOND_MS })],
			T + 30 * SECOND_MS
		);
		expect(newer).toHaveLength(1);
		expect(newer[0]?.sourceAt).toBe(T + 25 * SECOND_MS);
	});

	it("tracks bus routes separately", () => {
		const state = new LatestState();
		state.applyBus("100100290", [bus()], T);
		state.applyBus(
			"100100029",
			[bus({ routeId: "100100029", vehId: "222" })],
			T
		);
		state.markSourceEmpty({ busRouteId: "100100029" }, T + 30 * SECOND_MS);

		const snap = state.snapshot("bus", T + 30 * SECOND_MS);
		expect(snap.vehicles).toHaveLength(2);
		expect(snap.staleSince).toBe(T + 30 * SECOND_MS);
		expect(snap.staleRoutes).toEqual({ "100100029": T + 30 * SECOND_MS });
		expect(state.snapshot("subway", T + 30 * SECOND_MS).staleSince).toBeNull();

		state.expire(T + BUS_TTL_MS + SECOND_MS);
		expect(state.snapshot("bus", T + BUS_TTL_MS + SECOND_MS).vehicles).toEqual(
			[]
		);
	});

	it("exposes previous bus positions for normalization", () => {
		const state = new LatestState();
		state.applyBus("100100290", [bus()], T);
		state.applyBus(
			"100100029",
			[bus({ routeId: "100100029", vehId: "222" })],
			T
		);
		const prev = state.busPrev("100100290");
		expect([...prev.keys()]).toEqual(["111033115"]);
		expect(prev.get("111033115")).toEqual({
			shapeDistanceM: 1213,
			sourceAt: T - 5 * SECOND_MS,
		});
		expect(state.busPrev("missing").size).toBe(0);
	});

	it("excludes vehicles past the TTL from snapshots before expire runs", () => {
		const state = new LatestState();
		state.applyBus("100100290", [bus()], T);
		expect(
			state.snapshot("bus", T + BUS_TTL_MS + SECOND_MS).vehicles
		).toHaveLength(0);
		expect(state.snapshot("bus", T + BUS_TTL_MS).vehicles).toHaveLength(1);
	});

	it("orders snapshot vehicles by key for stable output", () => {
		const state = new LatestState();
		state.applySubway(
			[
				subway({ rawTrainNo: "9" }),
				subway({ lineKey: "line1", rawTrainNo: "5" }),
			],
			T
		);
		const snap = state.snapshot("subway", T);
		expect(snap.generatedAt).toBe(T);
		expect(snap.vehicles.map((v) => `${v.lineKey}|${v.rawTrainNo}`)).toEqual([
			"line1|5",
			"line2|9",
		]);
	});
});

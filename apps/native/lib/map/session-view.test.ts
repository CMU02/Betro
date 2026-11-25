import type { Leg, Route } from "@Betro/commute/plan";
import { expect, it } from "bun:test";
import type { SessionRouteView } from "../commute/session-client";
import { viewFromSession } from "./session-view";

const leg = { lineName: "470", mode: "bus" } as Leg;

function route(rank: number): Route {
	return { legs: [leg, leg], rank, walkMinutes: [1, 1] } as Route;
}

function sessionRoute(
	overrides: Partial<SessionRouteView> = {}
): SessionRouteView {
	return {
		boardEtaEpoch: 1000,
		destinationEtaEpoch: 2000,
		etaState: "live",
		legVehicleIds: ["V1", null],
		positionState: "live",
		rank: 0,
		stopsAway: 2,
		...overrides,
	};
}

it("puts the session's vehicle on the boarding board so the sheet shows the same minutes as the lock screen", () => {
	const view = viewFromSession(route(0), sessionRoute(), {
		legIndex: 0,
		stage: "wait",
	});
	expect(view.destinationEtaAt).toBe(2_000_000);
	expect(view.legs[0]?.boardEtaAt).toBe(1_000_000);
	expect(view.legs[0]?.approaching).toEqual([
		{
			etaAt: 1_000_000,
			method: "official",
			stopsAway: 2,
			vehicleId: "V1",
		},
	]);
	expect(view.legs[1]?.approaching).toEqual([]);
	expect(view.legs[1]?.etaState).toBe("estimated");
});

it("marks the session's estimate as a timetable method so the sheet says estimated", () => {
	const view = viewFromSession(
		route(0),
		sessionRoute({ etaState: "estimated" }),
		{ legIndex: 0, stage: "walk" }
	);
	expect(view.legs[0]?.approaching[0]?.method).toBe("timetable");
	expect(view.legs[0]?.method).toBe("timetable");
});

it("adds no boarding entry once the rider is on board or without a vehicle", () => {
	expect(
		viewFromSession(route(0), sessionRoute(), { legIndex: 0, stage: "ride" })
			.legs[0]?.approaching
	).toEqual([]);
	expect(
		viewFromSession(route(0), sessionRoute({ legVehicleIds: [] }), {
			legIndex: 0,
			stage: "wait",
		}).legs[0]?.approaching
	).toEqual([]);
});

it("an alternative route knows only its first leg", () => {
	const view = viewFromSession(route(1), sessionRoute({ rank: 1 }), {
		legIndex: 1,
		stage: "ride",
	});
	expect(view.legs[0]?.approaching[0]?.vehicleId).toBe("V1");
	expect(view.legs[1]?.boardEtaAt).toBeNull();
});

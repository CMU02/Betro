import { DEFAULT_LEAD_MINUTES, DEFAULT_TIMEZONE } from "@Betro/commute/config";
import { type Leg, parsePlan } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import {
	addLeg,
	buildPlan,
	emptyRoute,
	type RouteDraft,
	removeLeg,
	setWalk,
} from "./route-draft";

const PLAN_ID = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";

function busLeg(line: string, boardSeq = 3, alightSeq = 10): Leg {
	return {
		alight: { name: "잠실역", seq: alightSeq, stop: "seoul-bus:200000" },
		board: { name: "강변역", seq: boardSeq, stop: "seoul-bus:100000" },
		line: `seoul-bus:${line}`,
		lineName: line,
		mode: "bus",
	};
}

function subwayLeg(): Leg {
	return {
		alight: { name: "강남", stop: "seoul-subway:0222" },
		board: { name: "잠실", stop: "seoul-subway:0216" },
		direction: "down",
		line: "seoul-subway:1002",
		lineName: "2호선",
		mode: "subway",
	};
}

function routeOf(...legs: Leg[]): RouteDraft {
	let route = emptyRoute();
	for (const leg of legs) {
		route = addLeg(route, leg);
	}
	return route;
}

const WEEKDAYS = [1, 2, 3, 4, 5];

function input(routes: RouteDraft[], days = WEEKDAYS) {
	return {
		days,
		includeHolidays: false,
		leaveMinute: 485,
		planId: PLAN_ID,
		routes,
	};
}

it("starts empty", () => {
	expect(emptyRoute().legs).toEqual([]);
});

it("fills default walks as legs are added", () => {
	const one = addLeg(emptyRoute(), busLeg("341"));
	expect(one.walkMinutes).toEqual([5, 5]);
	const two = addLeg(one, subwayLeg());
	expect(two.walkMinutes).toEqual([5, 3, 5]);
	expect(two.legs.map((leg) => leg.mode)).toEqual(["bus", "subway"]);
});

it("keeps walk length at legs + 1 when a middle leg is removed", () => {
	const route = routeOf(busLeg("341"), subwayLeg(), busLeg("360"));
	expect(route.walkMinutes).toEqual([5, 3, 3, 5]);
	const removed = removeLeg(route, 1);
	expect(removed.legs.map((leg) => leg.lineName)).toEqual(["341", "360"]);
	expect(removed.walkMinutes).toHaveLength(removed.legs.length + 1);
});

it("keeps walks the user changed when legs are added", () => {
	let route = addLeg(emptyRoute(), busLeg("341"));
	route = setWalk(route, 0, 12);
	route = setWalk(route, 1, 7);
	route = addLeg(route, subwayLeg());
	expect(route.walkMinutes).toEqual([12, 3, 7]);
});

it("keeps the first and last walks when the first or last leg is removed", () => {
	let route = routeOf(busLeg("341"), subwayLeg());
	route = setWalk(route, 0, 9);
	route = setWalk(route, 2, 8);
	expect(removeLeg(route, 0).walkMinutes).toEqual([9, 8]);
	expect(removeLeg(route, 1).walkMinutes).toEqual([9, 8]);
	expect(removeLeg(removeLeg(route, 1), 0)).toEqual(emptyRoute());
});

it("clamps walks to 0..60 minutes", () => {
	const route = routeOf(busLeg("341"));
	expect(setWalk(route, 0, -4).walkMinutes).toEqual([0, 5]);
	expect(setWalk(route, 1, 75).walkMinutes).toEqual([5, 60]);
	expect(setWalk(route, 0, 2.6).walkMinutes).toEqual([3, 5]);
});

it("ignores walk and leg indexes out of range", () => {
	const route = routeOf(busLeg("341"));
	expect(setWalk(route, 2, 10)).toEqual(route);
	expect(removeLeg(route, 3)).toEqual(route);
});

it("reports a primary route without legs", () => {
	expect(buildPlan(input([emptyRoute()]))).toEqual({
		issues: ["no-leg"],
		ok: false,
	});
	expect(buildPlan(input([]))).toEqual({ issues: ["no-leg"], ok: false });
});

it("reports a route with five legs", () => {
	const five = routeOf(
		busLeg("1"),
		busLeg("2"),
		busLeg("3"),
		busLeg("4"),
		busLeg("5")
	);
	expect(buildPlan(input([five]))).toEqual({
		issues: ["too-many-legs"],
		ok: false,
	});
});

it("reports four alternatives", () => {
	const routes = [
		routeOf(busLeg("341")),
		routeOf(busLeg("360")),
		routeOf(busLeg("3412")),
		routeOf(subwayLeg()),
		routeOf(busLeg("472")),
	];
	expect(buildPlan(input(routes))).toEqual({
		issues: ["too-many-routes"],
		ok: false,
	});
});

it("reports a schedule without days", () => {
	expect(buildPlan(input([routeOf(busLeg("341"))], []))).toEqual({
		issues: ["no-day"],
		ok: false,
	});
});

it("builds a plan that passes parsePlan", () => {
	const routes = [
		routeOf(busLeg("341"), subwayLeg()),
		emptyRoute(),
		routeOf(busLeg("360")),
		routeOf(subwayLeg()),
	];
	const result = buildPlan(input(routes));
	if (!result.ok) {
		throw new Error(`expected a plan, got ${result.issues.join(", ")}`);
	}
	const { plan } = result;
	expect(parsePlan(plan)).toEqual({ ok: true, plan });
	expect(plan.planId).toBe(PLAN_ID);
	expect(plan.enabled).toBe(true);
	expect(plan.schedule).toEqual({
		days: WEEKDAYS,
		includeHolidays: false,
		leadMinutes: DEFAULT_LEAD_MINUTES,
		leaveMinute: 485,
		timezone: DEFAULT_TIMEZONE,
	});
	expect(plan.routes.map((route) => route.rank)).toEqual([0, 1, 2]);
	expect(plan.routes[0]?.walkMinutes).toEqual([5, 3, 5]);
	expect(plan.routes[1]?.legs[0]?.lineName).toBe("360");
});

it("reports a bus leg that alights before it boards as invalid", () => {
	const backwards = routeOf(busLeg("341", 10, 3));
	expect(buildPlan(input([backwards]))).toEqual({
		issues: ["invalid"],
		ok: false,
	});
});

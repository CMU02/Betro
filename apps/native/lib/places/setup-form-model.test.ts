import { DEFAULT_TIMEZONE } from "@Betro/commute/config";
import type { Leg } from "@Betro/commute/plan";
import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import { addLeg, emptyRoute, type RouteDraft } from "./route-draft";
import type { SetupDraft } from "./setup-draft";
import {
	canAddAlternative,
	canAddLeg,
	dateFromMinute,
	destinationName,
	issueNotices,
	minuteFromDate,
	parseRouteIndex,
	placeFromDraft,
	removeLegAt,
	removeRoute,
	routeRows,
	routeWithLeg,
	saveOutcome,
	setupTitle,
	setWalkAt,
	toggleDay,
} from "./setup-form-model";

const PLAN_ID = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";

const BUS_LEG: Leg = {
	alight: { name: "역삼역.포스코사거리", seq: 8, stop: "seoul-bus:10008" },
	board: { name: "잠실역.롯데월드", seq: 3, stop: "seoul-bus:10003" },
	line: "seoul-bus:100100341",
	lineName: "341",
	mode: "bus",
};

const SUBWAY_LEG: Leg = {
	alight: { name: "강남", stop: "seoul-subway:1002000222" },
	board: { name: "역삼", stop: "seoul-subway:1002000221" },
	direction: "down",
	line: "seoul-subway:line2",
	lineName: "2호선",
	mode: "subway",
};

function routeOf(...legs: Leg[]): RouteDraft {
	let route = emptyRoute();
	for (const leg of legs) {
		route = addLeg(route, leg);
	}
	return route;
}

function draftOf(overrides: Partial<SetupDraft> = {}): SetupDraft {
	return {
		days: [1, 2, 3, 4, 5],
		includeHolidays: false,
		kind: "work",
		leaveMinute: 490,
		name: "",
		placeId: "place-1",
		planId: PLAN_ID,
		routes: [routeOf(BUS_LEG)],
		...overrides,
	};
}

it("builds a pending place from a complete draft", () => {
	const result = placeFromDraft(draftOf(), 1234);
	expect(result.ok).toBe(true);
	if (!result.ok) {
		return;
	}
	expect(result.place.id).toBe("place-1");
	expect(result.place.kind).toBe("work");
	expect(result.place.sync).toBe("pending");
	expect(result.place.updatedAt).toBe(1234);
	expect(result.place.plan.planId).toBe(PLAN_ID);
	expect(result.place.plan.schedule.timezone).toBe(DEFAULT_TIMEZONE);
	expect(result.place.plan.schedule.leaveMinute).toBe(490);
});

it("requires a name for an other place and trims it", () => {
	const missing = placeFromDraft(draftOf({ kind: "other", name: "  " }), 1);
	expect(missing).toEqual({ issues: ["name-required"], ok: false });
	const named = placeFromDraft(draftOf({ kind: "other", name: " 헬스장 " }), 1);
	expect(named.ok && named.place.name).toBe("헬스장");
});

it("does not keep a typed name for a kind that has its own name", () => {
	const result = placeFromDraft(draftOf({ kind: "home", name: "헬스장" }), 1);
	expect(result.ok && result.place.name).toBe("");
});

it("collects the name issue together with the route and day issues", () => {
	const result = placeFromDraft(
		draftOf({ days: [], kind: "other", name: "", routes: [emptyRoute()] }),
		1
	);
	expect(result.ok).toBe(false);
	if (result.ok) {
		return;
	}
	expect([...result.issues].sort()).toEqual(
		["name-required", "no-day", "no-leg"].sort()
	);
});

it("puts each issue under the section it belongs to", () => {
	expect(
		issueNotices(["name-required", "no-leg", "no-day", "invalid"])
	).toEqual({
		name: "placeSetup.issue.nameRequired",
		routes: "placeSetup.issue.noLeg",
		save: "placeSetup.issue.invalid",
		schedule: "placeSetup.issue.noDay",
	});
	expect(issueNotices(["too-many-legs"]).routes).toBe(
		"placeSetup.issue.tooManyLegs"
	);
	expect(issueNotices(["too-many-routes"]).routes).toBe(
		"placeSetup.issue.tooManyRoutes"
	);
	expect(issueNotices([])).toEqual({});
});

it("closes after saved or pending and stays with a message otherwise", () => {
	expect(saveOutcome("saved")).toEqual({ kind: "close" });
	expect(saveOutcome("pending")).toEqual({ kind: "close" });
	expect(saveOutcome("limit")).toEqual({
		kind: "error",
		message: "placeSetup.save.limit",
	});
	expect(saveOutcome({ rejected: ["routes.0: bad"] })).toEqual({
		kind: "error",
		message: "placeSetup.save.rejected",
	});
});

it("toggles a weekday and keeps the days sorted", () => {
	expect(toggleDay([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 4, 5]);
	expect(toggleDay([5, 1], 0)).toEqual([0, 1, 5]);
	expect(toggleDay([], 6)).toEqual([6]);
});

it("converts between minute of day and a picker date by wall clock", () => {
	const base = new Date(2026, 10, 11, 15, 42, 30);
	const date = dateFromMinute(490, base);
	expect(date.getHours()).toBe(8);
	expect(date.getMinutes()).toBe(10);
	expect(date.getSeconds()).toBe(0);
	expect(minuteFromDate(date)).toBe(490);
	expect(minuteFromDate(dateFromMinute(5, base))).toBe(5);
	expect(minuteFromDate(dateFromMinute(1439, base))).toBe(1439);
});

it("lists walk and ride rows with walk labels toward the next stop", () => {
	const rows = routeRows(routeOf(BUS_LEG, SUBWAY_LEG), "회사", t);
	expect(rows.map((row) => row.kind)).toEqual([
		"walk",
		"ride",
		"walk",
		"ride",
		"walk",
	]);
	expect(rows[0]).toEqual({
		kind: "walk",
		label: "잠실역.롯데월드까지 도보",
		minutes: 5,
		walkIndex: 0,
	});
	expect(rows[2]).toMatchObject({ label: "역삼까지 도보", minutes: 3 });
	expect(rows[4]).toMatchObject({ label: "회사까지 도보", walkIndex: 2 });
	expect(rows[1]).toEqual({
		badge: { mode: "bus", name: "341", region: "seoul", routeType: "" },
		detail: "341번 · 5정거장",
		kind: "ride",
		legIndex: 0,
		title: "잠실역.롯데월드 → 역삼역.포스코사거리",
	});
	expect(rows[3]).toMatchObject({
		badge: { line: "seoul-subway:line2", mode: "subway", name: "2호선" },
		detail: "2호선",
		legIndex: 1,
		title: "역삼 → 강남",
	});
	expect(routeRows(emptyRoute(), "회사", t)).toEqual([]);
});

it("names the destination after the kind, or the typed name", () => {
	expect(destinationName({ kind: "work", name: "" }, t)).toBe("회사");
	expect(destinationName({ kind: "other", name: "헬스장" }, t)).toBe("헬스장");
	expect(destinationName({ kind: "other", name: " " }, t)).toBe("목적지");
});

it("titles the screen for a new place and for editing one", () => {
	expect(setupTitle("new", { kind: "work", name: "" }, t)).toBe("장소 추가");
	expect(setupTitle("edit", { kind: "work", name: "" }, t)).toBe("회사 설정");
	expect(setupTitle("edit", { kind: "other", name: "" }, t)).toBe(
		"가져온 경로 설정"
	);
});

it("drops an alternative whose last leg is removed but keeps the primary route", () => {
	const routes = [routeOf(BUS_LEG), routeOf(SUBWAY_LEG), routeOf(BUS_LEG)];
	const withoutAlternative = removeLegAt(routes, 1, 0);
	expect(withoutAlternative).toHaveLength(2);
	expect(withoutAlternative[1]).toEqual(routes[2] as RouteDraft);
	const emptyPrimary = removeLegAt(routes, 0, 0);
	expect(emptyPrimary).toHaveLength(3);
	expect(emptyPrimary[0]).toEqual(emptyRoute());
	const twoLegs = removeLegAt([routeOf(BUS_LEG, SUBWAY_LEG)], 0, 1);
	expect(twoLegs[0]?.legs).toEqual([BUS_LEG]);
	expect(removeLegAt(routes, 5, 0)).toBe(routes);
});

it("removes an alternative route but never the primary one", () => {
	const routes = [routeOf(BUS_LEG), routeOf(SUBWAY_LEG)];
	expect(removeRoute(routes, 1)).toEqual([routes[0] as RouteDraft]);
	expect(removeRoute(routes, 0)).toBe(routes);
	expect(removeRoute(routes, 4)).toBe(routes);
});

it("sets one walk on one route within 0 to 60 minutes", () => {
	const routes = [routeOf(BUS_LEG), routeOf(SUBWAY_LEG)];
	const changed = setWalkAt(routes, 1, 0, 75);
	expect(changed[1]?.walkMinutes).toEqual([60, 5]);
	expect(changed[0]).toBe(routes[0] as RouteDraft);
});

it("adds a picked leg to an existing route or to a new alternative", () => {
	const routes = [routeOf(BUS_LEG)];
	expect(routeWithLeg(routes, 0, SUBWAY_LEG).legs).toEqual([
		BUS_LEG,
		SUBWAY_LEG,
	]);
	expect(routeWithLeg(routes, 1, SUBWAY_LEG)).toEqual(routeOf(SUBWAY_LEG));
});

it("allows up to four legs and three alternatives", () => {
	expect(canAddLeg(routeOf(BUS_LEG, BUS_LEG, BUS_LEG))).toBe(true);
	expect(canAddLeg(routeOf(BUS_LEG, BUS_LEG, BUS_LEG, BUS_LEG))).toBe(false);
	const three = [routeOf(BUS_LEG), routeOf(BUS_LEG), routeOf(BUS_LEG)];
	expect(canAddAlternative(three)).toBe(true);
	expect(canAddAlternative([...three, routeOf(BUS_LEG)])).toBe(false);
});

it("reads the route index from the screen parameter", () => {
	expect(parseRouteIndex("0", 1)).toBe(0);
	expect(parseRouteIndex("1", 1)).toBe(1);
	expect(parseRouteIndex("2", 1)).toBeNull();
	expect(parseRouteIndex("4", 4)).toBeNull();
	expect(parseRouteIndex("-1", 1)).toBeNull();
	expect(parseRouteIndex("1.5", 3)).toBeNull();
	expect(parseRouteIndex(undefined, 1)).toBeNull();
	expect(parseRouteIndex(["0", "1"], 1)).toBe(0);
});

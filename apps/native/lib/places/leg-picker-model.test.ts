import { expect, it } from "bun:test";

import { t } from "../i18n/t";
import type { BusRouteMatch, BusStop, SubwayBranch } from "../ref/ref-client";
import {
	alightChoices,
	boardChoices,
	branchLabel,
	busLeg,
	busMetaOf,
	busRouteRow,
	directionView,
	filterBranchChoices,
	filterStopChoices,
	isBranchUnavailable,
	isNoMatch,
	type LegStep,
	lookupView,
	previousStep,
	searchView,
	subwayAlightChoices,
	subwayBoardChoices,
	subwayLeg,
} from "./leg-picker-model";
import { addLeg, buildPlan, emptyRoute } from "./route-draft";

const PLAN_ID = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";

function stop(
	seq: number,
	name: string,
	overrides: Partial<BusStop> = {}
): BusStop {
	return {
		arsId: `2${String(seq).padStart(4, "0")}`,
		directionName: null,
		name,
		seq,
		stop: `seoul-bus:1000${seq}`,
		...overrides,
	};
}

const STOPS: BusStop[] = [
	stop(1, "하남공영차고지"),
	stop(2, "몽촌토성역"),
	stop(3, "잠실역.롯데월드", { directionName: "강남역" }),
	stop(4, "잠실새내역"),
	stop(5, "역삼역.포스코사거리"),
	stop(6, "강남역"),
];

/** 순환 노선: 같은 이름 정류장이 방면만 달리 두 번 나온다. */
const LOOP_STOPS: BusStop[] = [
	stop(1, "서초구청", { directionName: "교대역" }),
	stop(2, "교대역"),
	stop(3, "서초구청", { directionName: "양재역" }),
	stop(4, "양재역"),
];

const SEOUL_341: BusRouteMatch = {
	line: "seoul-bus:100100341",
	name: "341",
	region: "seoul",
	routeType: "3",
	shortName: "341",
};

const GYEONGGI_M5107: BusRouteMatch = {
	line: "seoul-bus:234000884",
	name: "M5107광주",
	region: "gyeonggi",
	routeType: "8",
	shortName: "M5107",
};

const LINE2 = { line: "seoul-subway:line2", name: "2호선" };

const LINE2_BRANCHES: SubwayBranch[] = [
	{
		branchKey: "main",
		stations: [
			{ name: "잠실", stop: "seoul-subway:1002000216" },
			{ name: "잠실새내", stop: "seoul-subway:1002000217" },
			{ name: "강남", stop: "seoul-subway:1002000222" },
		],
	},
	{
		branchKey: "seongsu",
		stations: [
			{ name: "성수", stop: "seoul-subway:1002000211" },
			{ name: "용답", stop: "seoul-subway:1002002111" },
		],
	},
];

function planWith(...legs: Parameters<typeof addLeg>[1][]) {
	let route = emptyRoute();
	for (const leg of legs) {
		route = addLeg(route, leg);
	}
	return buildPlan({
		days: [1, 2, 3, 4, 5],
		includeHolidays: false,
		leaveMinute: 490,
		planId: PLAN_ID,
		routes: [route],
	});
}

it("does not let the last stop be a boarding stop", () => {
	const choices = boardChoices(STOPS);
	expect(choices.map((choice) => choice.disabled)).toEqual([
		false,
		false,
		false,
		false,
		false,
		true,
	]);
	expect(choices[2]?.label).toBe("잠실역.롯데월드");
	expect(choices[2]?.stop).toBe(STOPS[2] as BusStop);
});

it("disables the boarding stop and every stop before it when alighting", () => {
	const board = STOPS[2] as BusStop;
	const choices = alightChoices(STOPS, board);
	expect(choices.map((choice) => choice.disabled)).toEqual([
		true,
		true,
		true,
		false,
		false,
		false,
	]);
});

it("tells apart two stops with the same name on one route", () => {
	const choices = boardChoices(LOOP_STOPS, t);
	const first = choices[0]?.sub;
	const second = choices[2]?.sub;
	expect(first).toBe("교대역 방면");
	expect(second).toBe("양재역 방면");
	expect(first).not.toBe(second);
	// 이름이 한 번만 나오는 정류장에는 구분 글자가 없다.
	expect(choices[1]?.sub).toBeNull();
});

it("falls back to the stop number when the direction does not tell them apart", () => {
	const stops: BusStop[] = [
		stop(1, "서초구청", { arsId: "22001" }),
		stop(2, "교대역"),
		stop(3, "서초구청", { arsId: "22002" }),
	];
	const choices = boardChoices(stops, t);
	expect(choices[0]?.sub).toBe("22001");
	expect(choices[2]?.sub).toBe("22002");
});

it("keeps the raw direction name when no translator is given", () => {
	const choices = boardChoices(LOOP_STOPS);
	expect(choices[0]?.sub).toBe("교대역");
});

it("builds a bus leg that buildPlan accepts", () => {
	const leg = busLeg(SEOUL_341, STOPS[2] as BusStop, STOPS[4] as BusStop);
	expect(leg).toEqual({
		alight: { name: "역삼역.포스코사거리", seq: 5, stop: "seoul-bus:10005" },
		board: { name: "잠실역.롯데월드", seq: 3, stop: "seoul-bus:10003" },
		line: "seoul-bus:100100341",
		lineName: "341",
		mode: "bus",
	});
	expect(planWith(leg).ok).toBe(true);
});

it("uses the short name of a Gyeonggi route as the line name", () => {
	const leg = busLeg(GYEONGGI_M5107, STOPS[0] as BusStop, STOPS[1] as BusStop);
	expect(leg.lineName).toBe("M5107");
});

it("makes buildPlan reject a bus leg that alights before it boards", () => {
	const leg = busLeg(SEOUL_341, STOPS[4] as BusStop, STOPS[2] as BusStop);
	const plan = planWith(leg);
	expect(plan.ok).toBe(false);
});

it("disables a branch that does not have the boarding station", () => {
	const choices = subwayAlightChoices(
		LINE2_BRANCHES,
		"seoul-subway:1002000216"
	);
	const [main, seongsu] = choices;
	expect(main?.branchKey).toBe("main");
	expect(main?.stations.map((station) => station.disabled)).toEqual([
		true,
		false,
		false,
	]);
	expect(seongsu?.branchKey).toBe("seongsu");
	expect(seongsu?.stations.every((station) => station.disabled)).toBe(true);
});

it("offers every station of every branch for boarding", () => {
	const choices = subwayBoardChoices(LINE2_BRANCHES);
	expect(choices.map((branch) => branch.stations.length)).toEqual([3, 2]);
	expect(
		choices.every((branch) =>
			branch.stations.every((station) => !station.disabled)
		)
	).toBe(true);
});

it("builds a subway leg that buildPlan accepts", () => {
	const leg = subwayLeg(
		LINE2,
		{ name: "잠실", stop: "seoul-subway:1002000216" },
		{ name: "강남", stop: "seoul-subway:1002000222" },
		"down"
	);
	expect(leg).toEqual({
		alight: { name: "강남", stop: "seoul-subway:1002000222" },
		board: { name: "잠실", stop: "seoul-subway:1002000216" },
		direction: "down",
		line: "seoul-subway:line2",
		lineName: "2호선",
		mode: "subway",
	});
	expect(planWith(leg).ok).toBe(true);
});

it("lets a route mix a bus leg and a subway leg", () => {
	const bus = busLeg(SEOUL_341, STOPS[2] as BusStop, STOPS[4] as BusStop);
	const subway = subwayLeg(
		LINE2,
		{ name: "잠실", stop: "seoul-subway:1002000216" },
		{ name: "강남", stop: "seoul-subway:1002000222" },
		"down"
	);
	expect(planWith(bus, subway).ok).toBe(true);
});

it("labels search results so same-number routes differ by region", () => {
	const seoul = busRouteRow(SEOUL_341, t);
	const gyeonggi = busRouteRow(
		{ ...SEOUL_341, region: "gyeonggi", routeType: "8" },
		t
	);
	const incheon = busRouteRow(
		{ ...SEOUL_341, region: "incheon", routeType: "7" },
		t
	);
	expect(seoul.badge).toEqual({
		mode: "bus",
		name: "341",
		region: "seoul",
		routeType: "3",
	});
	expect(seoul.sub).toBe("서울 간선");
	expect(gyeonggi.sub).toBe("경기 버스");
	expect(incheon.sub).toBe("인천 버스");
	expect(new Set([seoul.sub, gyeonggi.sub, incheon.sub]).size).toBe(3);
	expect(busRouteRow({ ...SEOUL_341, routeType: "2" }, t).sub).toBe(
		"서울 마을"
	);
});

it("names the known branches and numbers the rest", () => {
	expect(branchLabel("main", 0, t)).toBe("본선");
	expect(branchLabel("seongsu", 1, t)).toBe("성수지선");
	expect(branchLabel("unknown-branch", 2, t)).toBe("갈래 3");
});

it("shows a hint for an empty query and never calls it no result", () => {
	expect(searchView("", undefined, false)).toBe("hint");
	expect(searchView("   ", undefined, false)).toBe("hint");
	expect(searchView("341", undefined, true)).toBe("loading");
	expect(searchView("341", { ok: false, reason: "offline" }, false)).toBe(
		"failed"
	);
	expect(searchView("341", { ok: false, reason: "unavailable" }, false)).toBe(
		"failed"
	);
	expect(searchView("341", { ok: true, value: [] }, false)).toBe("empty");
	expect(searchView("341", { ok: true, value: [SEOUL_341] }, false)).toBe(
		"results"
	);
});

it("reads a lookup result as loading, failed, not found or ready", () => {
	expect(lookupView(undefined)).toBe("loading");
	expect(lookupView({ ok: false, reason: "offline" })).toBe("failed");
	expect(lookupView({ ok: false, reason: "unavailable" })).toBe("failed");
	expect(lookupView({ ok: false, reason: "invalid" })).toBe("failed");
	expect(lookupView({ ok: false, reason: "not-found" })).toBe("not-found");
	expect(lookupView({ ok: true, value: [] })).toBe("ready");
});

it("goes back one step at a time and leaves the screen from the first step", () => {
	const board = STOPS[2] as BusStop;
	const station = { name: "잠실", stop: "seoul-subway:1002000216" };
	const steps: [LegStep, LegStep | null][] = [
		[{ kind: "mode" }, null],
		[{ kind: "bus-search" }, { kind: "mode" }],
		[{ kind: "bus-board", route: SEOUL_341 }, { kind: "bus-search" }],
		[
			{ board, kind: "bus-alight", route: SEOUL_341 },
			{ kind: "bus-board", route: SEOUL_341 },
		],
		[{ kind: "subway-line" }, { kind: "mode" }],
		[{ kind: "subway-board", line: LINE2 }, { kind: "subway-line" }],
		[
			{ board: station, kind: "subway-alight", line: LINE2 },
			{ kind: "subway-board", line: LINE2 },
		],
	];
	for (const [step, previous] of steps) {
		expect(previousStep(step)).toEqual(previous);
	}
});

it("marks only the branches that lack the boarding station as unavailable", () => {
	const board = "seoul-subway:1002000216";
	const [main, seongsu] = subwayAlightChoices(LINE2_BRANCHES, board);
	expect(main && isBranchUnavailable(main, board)).toBe(false);
	expect(seongsu && isBranchUnavailable(seongsu, board)).toBe(true);
});

it("reads the direction lookup as checking, ready, not direct or failed", () => {
	expect(directionView(undefined, true)).toBe("checking");
	expect(directionView({ ok: false, reason: "offline" }, true)).toBe(
		"checking"
	);
	expect(
		directionView({ ok: true, value: { direction: "down", stops: 3 } }, false)
	).toBe("ready");
	expect(directionView({ ok: false, reason: "not-direct" }, false)).toBe(
		"not-direct"
	);
	expect(directionView({ ok: false, reason: "offline" }, false)).toBe("failed");
	expect(directionView({ ok: false, reason: "not-found" }, false)).toBe(
		"failed"
	);
	expect(directionView(undefined, false)).toBe("checking");
});

it("keeps the route type and region of a picked bus route for the device", () => {
	expect(busMetaOf(GYEONGGI_M5107)).toEqual({
		region: "gyeonggi",
		routeType: "8",
	});
	expect(busMetaOf(SEOUL_341)).toEqual({ region: "seoul", routeType: "3" });
});

it("filters boarding stops by name, ignoring case, spaces and dots", () => {
	const choices = boardChoices(STOPS, t);
	const labels = (query: string) =>
		filterStopChoices(choices, query).map((choice) => choice.label);
	expect(labels("")).toEqual(STOPS.map((entry) => entry.name));
	expect(labels("   ")).toEqual(STOPS.map((entry) => entry.name));
	expect(labels(" 잠실 ")).toEqual(["잠실역.롯데월드", "잠실새내역"]);
	expect(labels("잠실역 롯데")).toEqual(["잠실역.롯데월드"]);
	expect(labels("잠실역롯데월드")).toEqual(["잠실역.롯데월드"]);
	expect(labels("역삼역·포스코")).toEqual(["역삼역.포스코사거리"]);
	expect(labels("강남")).toEqual(["강남역"]);
	expect(labels("신촌")).toEqual([]);
	expect(
		filterStopChoices(boardChoices([stop(1, "DMC역")]), "dmc")
	).toHaveLength(1);
});

it("keeps the same-name sub and the last-stop lock of the full list when filtering", () => {
	const loop = filterStopChoices(boardChoices(LOOP_STOPS, t), "서초구청");
	expect(loop.map((choice) => choice.sub)).toEqual([
		"교대역 방면",
		"양재역 방면",
	]);
	const last = filterStopChoices(boardChoices(STOPS, t), "강남역");
	expect(last.map((choice) => choice.disabled)).toEqual([true]);
});

it("treats a query of only spaces and dots as no query", () => {
	expect(filterStopChoices(boardChoices(STOPS), " . · ")).toHaveLength(
		STOPS.length
	);
	expect(isNoMatch(" . · ", 0)).toBe(false);
	expect(isNoMatch("", 0)).toBe(false);
	expect(isNoMatch("신촌", 0)).toBe(true);
	expect(isNoMatch("잠실", 2)).toBe(false);
});

it("filters boarding stations per branch and keeps each branch's heading", () => {
	const branches = subwayBoardChoices(LINE2_BRANCHES);
	const all = filterBranchChoices(branches, "");
	expect(all.showHeadings).toBe(true);
	expect(all.branches.map((entry) => entry.index)).toEqual([0, 1]);
	expect(all.branches.map((entry) => entry.branch)).toEqual(branches);

	const seongsu = filterBranchChoices(branches, "성수");
	// 본선이 걸러져도 남은 지선은 원래 머리("성수지선")와 순번을 그대로 쓴다
	expect(seongsu.showHeadings).toBe(true);
	expect(seongsu.branches).toEqual([
		{
			branch: {
				branchKey: "seongsu",
				stations: [
					{ disabled: false, name: "성수", stop: "seoul-subway:1002000211" },
				],
			},
			index: 1,
		},
	]);

	expect(
		filterBranchChoices(branches, "잠실").branches.map((entry) =>
			entry.branch.stations.map((station) => station.name)
		)
	).toEqual([["잠실", "잠실새내"]]);
	expect(filterBranchChoices(branches, "신촌").branches).toEqual([]);

	const single = filterBranchChoices(branches.slice(0, 1), "강남");
	expect(single.showHeadings).toBe(false);
});

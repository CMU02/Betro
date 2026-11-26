import { describe, expect, it } from "bun:test";

import type { SearchIndex } from "./search-client";
import type { SearchTarget } from "./search-model";
import {
	lineNameKey,
	routeTarget,
	searchViewState,
	stationLineKeys,
	stationTarget,
	stopSubtitleKey,
	stopTarget,
	targetHref,
} from "./search-view-model";

const INDEX: SearchIndex = {
	routes: [
		{
			line: "seoul-bus:100100118",
			name: "146",
			routeType: "3",
			shortName: "146",
		},
	],
	stations: [
		{
			key: "seoul-subway:gangnam",
			lat: 37.49,
			lng: 127.02,
			members: [
				{ line: "seoul-subway:line2", stop: "seoul-subway:1002000222" },
				{ line: "seoul-subway:shinbundang", stop: "seoul-subway:1077000001" },
				{ line: "seoul-subway:line2", stop: "seoul-subway:1002000223" },
			],
			name: "강남",
		},
	],
	stops: [
		{
			arsId: "22009",
			lat: 37.49,
			lng: 127.02,
			name: "강남역5번출구",
			stop: "seoul-bus:121000009",
			towards: "역삼역",
		},
	],
};

const RECENTS: SearchTarget[] = [
	{ key: "seoul-subway:gangnam", kind: "station", name: "강남" },
];

const MIXED_RECENTS: SearchTarget[] = [
	{ kind: "stop", name: "강남역5번출구", stop: "seoul-bus:121000009" },
	{
		kind: "route",
		line: "seoul-bus:100100118",
		name: "146",
		shortName: "146",
	},
	{ key: "seoul-subway:gangnam", kind: "station", name: "강남" },
	{ kind: "stop", name: "없어진정류장", stop: "seoul-bus:gone" },
];

const BASE = {
	failed: false,
	index: INDEX,
	query: "",
	recents: RECENTS,
	scope: "all" as const,
};

describe("searchViewState", () => {
	it("색인이 없고 실패했으면 failed, 아직이면 loading이다", () => {
		expect(searchViewState({ ...BASE, failed: true, index: null })).toEqual({
			kind: "failed",
		});
		expect(searchViewState({ ...BASE, index: null })).toEqual({
			kind: "loading",
		});
	});

	it("받아 둔 색인이 있으면 실패 표시가 있어도 검색한다", () => {
		const state = searchViewState({ ...BASE, failed: true, query: "강남" });
		expect(state.kind).toBe("results");
	});

	it("질의가 비면 최근 검색, 결과가 없으면 empty다", () => {
		expect(searchViewState(BASE)).toEqual({
			kind: "recents",
			recents: [
				{
					kind: "station",
					station: INDEX.stations[0] ?? null,
					target: RECENTS[0] as Extract<SearchTarget, { kind: "station" }>,
				},
			],
		});
		expect(searchViewState({ ...BASE, query: "   " }).kind).toBe("recents");
		expect(searchViewState({ ...BASE, query: "없는곳" })).toEqual({
			kind: "empty",
		});
	});

	it("최근 검색은 색인 항목을 붙여 유형대로 그릴 수 있게 하고, 색인에 없으면 null이다", () => {
		const state = searchViewState({ ...BASE, recents: MIXED_RECENTS });
		if (state.kind !== "recents") {
			throw new Error(`expected recents, got ${state.kind}`);
		}
		expect(state.recents.map((recent) => recent.kind)).toEqual([
			"stop",
			"route",
			"station",
			"stop",
		]);
		const [stop, route, station, gone] = state.recents;
		expect(stop?.kind === "stop" && stop.stop?.arsId).toBe("22009");
		expect(route?.kind === "route" && route.route?.routeType).toBe("3");
		expect(station?.kind === "station" && station.station?.key).toBe(
			"seoul-subway:gangnam"
		);
		expect(gone?.kind === "stop" && gone.stop).toBeNull();
		expect(gone?.target.name).toBe("없어진정류장");
	});

	it("질의가 비어도 고른 범위 칩으로 최근 검색을 거른다", () => {
		const kinds = (scope: "all" | "station" | "stop" | "route") => {
			const state = searchViewState({
				...BASE,
				recents: MIXED_RECENTS,
				scope,
			});
			return state.kind === "recents"
				? state.recents.map((recent) => recent.target.name)
				: [];
		};
		expect(kinds("stop")).toEqual(["강남역5번출구", "없어진정류장"]);
		expect(kinds("station")).toEqual(["강남"]);
		expect(kinds("route")).toEqual(["146"]);
		expect(kinds("all")).toHaveLength(MIXED_RECENTS.length);
	});

	it("결과가 있으면 구역을 담아 돌려준다", () => {
		const state = searchViewState({ ...BASE, query: "146" });
		expect(state.kind).toBe("results");
		if (state.kind === "results") {
			expect(state.sections.routes).toHaveLength(1);
		}
	});
});

describe("targetHref", () => {
	it("ref를 인코딩한다", () => {
		expect(
			targetHref({
				kind: "stop",
				name: "강남역",
				stop: "seoul-bus:121000012",
			})
		).toBe("/stop/seoul-bus%3A121000012");
		expect(targetHref(RECENTS[0])).toBe("/station/seoul-subway%3Agangnam");
		expect(
			targetHref({
				kind: "route",
				line: "seoul-bus:100100118",
				name: "146",
				shortName: "146",
			})
		).toBe("/bus/seoul-bus%3A100100118");
	});
});

describe("대상 만들기", () => {
	it("색인 항목을 최근 검색 대상으로 바꾼다", () => {
		expect(stationTarget(INDEX.stations[0])).toEqual(RECENTS[0]);
		expect(routeTarget(INDEX.routes[0])).toEqual({
			kind: "route",
			line: "seoul-bus:100100118",
			name: "146",
			shortName: "146",
		});
		expect(
			stopTarget({
				arsId: null,
				lat: 0,
				lng: 0,
				name: "강남역",
				stop: "seoul-bus:121000012",
				towards: null,
			})
		).toEqual({ kind: "stop", name: "강남역", stop: "seoul-bus:121000012" });
	});
});

describe("stationLineKeys", () => {
	it("구성 노선을 중복 없이 순서대로 돌려준다", () => {
		expect(stationLineKeys(INDEX.stations[0])).toEqual([
			"seoul-subway:line2",
			"seoul-subway:shinbundang",
		]);
	});
});

describe("lineNameKey", () => {
	it("노선 ref를 이름 문구 키로 바꾸고 모르는 노선은 null이다", () => {
		expect(lineNameKey("seoul-subway:line2")).toBe("search.lineName.line2");
		expect(lineNameKey("seoul-subway:gyeongui-jungang")).toBe(
			"search.lineName.gyeonguiJungang"
		);
		expect(lineNameKey("seoul-subway:unknown")).toBeNull();
	});
});

describe("stopSubtitleKey", () => {
	const stop = {
		arsId: "01234",
		lat: 0,
		lng: 0,
		name: "a",
		stop: "seoul-bus:1",
		towards: "서울역",
	};
	it("arsId나 towards가 없으면 그 부분을 뺀다", () => {
		expect(stopSubtitleKey(stop)).toBe("search.stopSubtitle");
		expect(stopSubtitleKey({ ...stop, towards: null })).toBe(
			"search.stopSubtitleArsId"
		);
		expect(stopSubtitleKey({ ...stop, arsId: null })).toBe(
			"search.stopSubtitleTowards"
		);
		expect(stopSubtitleKey({ ...stop, arsId: null, towards: null })).toBeNull();
	});
});

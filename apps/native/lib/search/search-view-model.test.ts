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
	stops: [],
};

const RECENTS: SearchTarget[] = [
	{ key: "seoul-subway:gangnam", kind: "station", name: "강남" },
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
			recents: RECENTS,
		});
		expect(searchViewState({ ...BASE, query: "   " }).kind).toBe("recents");
		expect(searchViewState({ ...BASE, query: "없는곳" })).toEqual({
			kind: "empty",
		});
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

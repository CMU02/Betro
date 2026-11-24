import { expect, it } from "bun:test";

import type { StationView } from "../detail/detail-client";
import type { Favorite } from "./favorites";
import {
	favoriteHref,
	filterFavorites,
	mergeStationViews,
	stationViewBatches,
	viewForMembers,
} from "./favorites-model";

const station = (name: string, count: number, offset = 0): Favorite => ({
	addedAt: 1,
	id: `station:${name}`,
	kind: "station",
	members: Array.from({ length: count }, (_, i) => ({
		line: `seoul-subway:line${i + offset}`,
		stop: `seoul-subway:${name}${i + offset}`,
	})),
	name,
});

const stop: Favorite = {
	addedAt: 2,
	arsId: "14601",
	id: "stop:seoul-bus:1",
	kind: "stop",
	name: "강남역",
	stop: "seoul-bus:1",
	towards: null,
};

const route: Favorite = {
	addedAt: 3,
	id: "route:seoul-bus:2",
	kind: "route",
	line: "seoul-bus:2",
	name: "146",
	routeType: "간선",
	shortName: "146",
};

it("필터는 종류만 남긴다", () => {
	const list = [station("a", 1), stop, route];
	expect(filterFavorites(list, "all")).toEqual(list);
	expect(filterFavorites(list, "station").map((f) => f.kind)).toEqual([
		"station",
	]);
	expect(filterFavorites(list, "stop")).toEqual([stop]);
	expect(filterFavorites(list, "route")).toEqual([route]);
});

it("역 즐겨찾기 7개 노선은 6개와 1개로 나눠 묻는다", () => {
	const batches = stationViewBatches([station("big", 7), stop, route]);
	expect(batches.map((batch) => batch.length)).toEqual([6, 1]);
});

it("역이 없으면 묻지 않고, 같은 역은 한 번만 묻는다", () => {
	expect(stationViewBatches([stop, route])).toEqual([]);
	const dup = [station("a", 2), station("a", 2)];
	expect(stationViewBatches(dup).flat().length).toBe(2);
});

it("받은 도착판을 하나로 합친다", () => {
	const view = (line: string): StationView => ({
		generatedAt: 1,
		stations: [{ directions: [], line, stop: `${line}-stop` }],
		timezone: "Asia/Seoul",
	});
	expect(mergeStationViews([])).toBeNull();
	expect(
		mergeStationViews([view("a"), view("b")])?.stations.map((s) => s.line)
	).toEqual(["a", "b"]);
});

it("묶음의 구성 역만 남긴다", () => {
	const view: StationView = {
		generatedAt: 1,
		stations: [
			{ directions: [], line: "l2", stop: "s1" },
			{ directions: [], line: "l2", stop: "s2" },
		],
		timezone: "Asia/Seoul",
	};
	expect(
		viewForMembers(view, [{ line: "l2", stop: "s2" }]).stations.map(
			(s) => s.stop
		)
	).toEqual(["s2"]);
});

it("카드는 검색 결과와 같은 상세 경로로 간다", () => {
	expect(favoriteHref(station("강남", 1))).toBe("/station/%EA%B0%95%EB%82%A8");
	expect(favoriteHref(stop)).toBe("/stop/seoul-bus%3A1");
	expect(favoriteHref(route)).toBe("/bus/seoul-bus%3A2");
});

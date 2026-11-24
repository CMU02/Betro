import { expect, it } from "bun:test";

import {
	FAVORITES_KEY,
	type Favorite,
	favoriteId,
	parseFavorites,
	serializeFavorites,
} from "./favorites";

const route = (line: string): Favorite => ({
	addedAt: 1,
	id: `route:${line}`,
	kind: "route",
	line,
	name: "146",
	routeType: "간선",
	shortName: "146",
});

const stop = (ref: string): Favorite => ({
	addedAt: 2,
	arsId: "14601",
	id: `stop:${ref}`,
	kind: "stop",
	name: "강남역",
	stop: ref,
	towards: null,
});

const station: Favorite = {
	addedAt: 3,
	id: "station:강남",
	kind: "station",
	members: [{ line: "seoul-subway:1002", stop: "seoul-subway:0222" }],
	name: "강남",
};

it("favoriteId는 종류별 접두사를 붙인다", () => {
	expect(favoriteId({ key: "강남", kind: "station" })).toBe("station:강남");
	expect(favoriteId({ kind: "stop", stop: "seoul-bus:1" })).toBe(
		"stop:seoul-bus:1"
	);
	expect(favoriteId({ kind: "route", line: "seoul-bus:2" })).toBe(
		"route:seoul-bus:2"
	);
});

it("저장하고 다시 읽으면 같은 목록이다", () => {
	const list = [station, stop("seoul-bus:1"), route("seoul-bus:2")];
	expect(parseFavorites(serializeFavorites(list))).toEqual(list);
	expect(FAVORITES_KEY).toBe("betro.favorites");
});

it("gbis·tago 노선이나 정류장은 읽을 때 버린다", () => {
	expect(
		parseFavorites(
			JSON.stringify({
				favorites: [
					route("gbis:200000037"),
					stop("tago:1"),
					route("seoul-bus:100100118"),
				],
				version: 1,
			})
		).map((f) => f.id)
	).toEqual(["route:seoul-bus:100100118"]);
});

it("역의 구성원이 범위 밖이면 그 항목을 버린다", () => {
	const bad: Favorite = {
		...station,
		members: [{ line: "gbis:1", stop: "gbis:2" }],
	};
	expect(parseFavorites(serializeFavorites([bad]))).toEqual([]);
});

it("모양이 틀린 항목만 버리고 나머지는 남긴다", () => {
	const raw = JSON.stringify({
		favorites: [{ kind: "route" }, 7, route("seoul-bus:2")],
		version: 1,
	});
	expect(parseFavorites(raw).map((f) => f.id)).toEqual(["route:seoul-bus:2"]);
});

it("깨진 저장값은 빈 목록이다", () => {
	expect(parseFavorites(null)).toEqual([]);
	expect(parseFavorites("{")).toEqual([]);
	expect(parseFavorites(JSON.stringify({ favorites: [], version: 2 }))).toEqual(
		[]
	);
	expect(parseFavorites(JSON.stringify([route("seoul-bus:2")]))).toEqual([]);
});

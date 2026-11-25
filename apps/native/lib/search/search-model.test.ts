import { expect, it } from "bun:test";

import type { SearchIndex } from "./search-client";
import { ALL_SECTION_LIMIT, normalizeQuery, searchIndex } from "./search-model";

const station = (name: string) => ({
	key: `seoul-subway:${name}`,
	lat: 37.5,
	lng: 127,
	members: [{ line: "seoul-subway:line2", stop: `seoul-subway:${name}` }],
	name,
});
const route = (shortName: string) => ({
	line: `seoul-bus:${shortName}`,
	name: shortName,
	routeType: "3",
	shortName,
});
const stop = (name: string, arsId: string | null) => ({
	arsId,
	lat: 37.5,
	lng: 127,
	name,
	stop: `seoul-bus:${arsId ?? name}`,
	towards: null,
});

// "신강남"은 포함 순위를 보이려는 가짜 이름이다.
const INDEX: SearchIndex = {
	routes: [route("9146"), route("146"), route("1460")],
	stations: [
		station("신강남"),
		station("강남구청"),
		station("강남"),
		station("역삼"),
	],
	stops: [stop("강남역", "14601"), stop("역삼역", "23001")],
};

it("'강남역'과 '강남'은 같은 역을 같음 순위로 찾는다", () => {
	expect(searchIndex(INDEX, "강남역", "all").stations[0]?.name).toBe("강남");
	expect(searchIndex(INDEX, " 강남 ", "all").stations[0]?.name).toBe("강남");
});

it("같음 > 앞부분 > 포함 순이고 '전체'는 구역마다 3개다", () => {
	expect(searchIndex(INDEX, "강남", "all").stations.map((s) => s.name)).toEqual(
		["강남", "강남구청", "신강남"]
	);
	const many: SearchIndex = {
		routes: [],
		stations: ["가1", "가2", "가3", "가4", "가5"].map(station),
		stops: [],
	};
	expect(searchIndex(many, "가", "all").stations).toHaveLength(
		ALL_SECTION_LIMIT
	);
});

it("숫자는 노선 번호 앞부분과 arsId 앞부분을 찾는다", () => {
	const found = searchIndex(INDEX, "146", "all");
	expect(found.routes[0]?.shortName).toBe("146");
	expect(found.routes.map((r) => r.shortName)).toEqual(["146", "1460", "9146"]);
	expect(found.stops.map((s) => s.arsId)).toEqual(["14601"]);
});

it("빈 질의는 빈 결과다", () => {
	expect(searchIndex(INDEX, "   ", "all")).toEqual({
		routes: [],
		stations: [],
		stops: [],
	});
	expect(normalizeQuery(" A b ")).toBe("ab");
});

it("범위 칩을 고르면 그 구역만 50개까지다", () => {
	const many: SearchIndex = {
		routes: [],
		stations: [],
		stops: Array.from({ length: 80 }, (_, i) => stop(`가${i}`, `${i}`)),
	};
	const scoped = searchIndex(many, "가", "stop");
	expect(scoped.stops).toHaveLength(50);
	expect(scoped.stations).toEqual([]);
	expect(searchIndex(INDEX, "강남", "route").stations).toEqual([]);
});

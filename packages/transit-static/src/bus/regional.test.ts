import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseGbisRouteList } from "../sources/gbis-api";
import type {
	RegionalRouteRow,
	RegionalStopRow,
} from "../sources/regional-bus-types";
import type { AssembledBusRoute } from "./assemble";
import {
	assembleRegionalRoute,
	assembleRegionalSource,
	dropSeoulDuplicates,
	regionalMinLoadableRatio,
} from "./regional";

function fixtureText(name: string): string {
	return readFileSync(
		new URL(`../sources/__fixtures__/${name}`, import.meta.url),
		"utf8"
	);
}

const GBIS_ROUTE: RegionalRouteRow = {
	areaName: "고양",
	cityCode: null,
	name: "011",
	routeId: "241308701",
	routeTypeCode: "30",
};
const M5107_ROUTE: RegionalRouteRow = {
	areaName: "광주",
	cityCode: null,
	name: "M5107",
	routeId: "234001243",
	routeTypeCode: "14",
};
const TAGO_ROUTE: RegionalRouteRow = {
	areaName: "인천",
	cityCode: "23",
	name: "523",
	routeId: "ICB365000085",
	routeTypeCode: "지선버스",
};
const GBIS_STATION_COUNT = 40;

function gbisStops(routeId: string): RegionalStopRow[] {
	const json = JSON.parse(fixtureText(`gbis-route-stations-${routeId}.json`));
	const rows = json.response.msgBody.busRouteStationList as Record<
		string,
		unknown
	>[];
	return rows.map((row) => ({
		arsId: null,
		lat: Number(row.y),
		lng: Number(row.x),
		name: String(row.stationName),
		seq: Number(row.stationSeq),
		stationId: String(row.stationId),
		turnSeq: null,
	}));
}

function assembleOk(
	input: Parameters<typeof assembleRegionalRoute>[0]
): AssembledBusRoute {
	const result = assembleRegionalRoute(input);
	if (!result.ok) {
		throw new Error(`ok여야 한다: ${result.issue.code}`);
	}
	return result.route;
}

const stop = (seq: number, lng: number, lat: number): RegionalStopRow => ({
	arsId: null,
	lat,
	lng,
	name: `정류장${seq}`,
	seq,
	stationId: `s${seq}`,
	turnSeq: null,
});

describe("assembleRegionalRoute", () => {
	it("경유 정류장 좌표를 순서대로 이은 선을 모양으로 쓴다", () => {
		const stops = gbisStops(GBIS_ROUTE.routeId);
		const route = assembleOk({
			info: { firstBusMinute: 360, headwayMin: 10, lastBusMinute: 1390 },
			route: GBIS_ROUTE,
			source: "gbis",
			stops,
		});
		expect(route.coords).toHaveLength(GBIS_STATION_COUNT);
		expect(route.coords).toEqual(stops.map((s) => [s.lng, s.lat]));
		const distances = route.stops.map((s) => s.distanceM);
		expect(distances[0]).toBe(0);
		for (let i = 1; i < distances.length; i += 1) {
			expect(distances[i]).toBeGreaterThan(distances[i - 1] ?? 0);
		}
		expect(route.lengthM).toBe(distances.at(-1) ?? -1);
		expect(route.lengthM).toBeGreaterThan(1000);
		expect(route.stops.every((s) => s.offsetM === 0)).toBe(true);
		expect(route.stops.every((s) => s.apiSectDistM === 0)).toBe(true);
		expect(route.segments).toHaveLength(GBIS_STATION_COUNT - 1);
		expect(route.segments.every((s) => s.apiSectDistM === 0)).toBe(true);
		expect(route.segments.every((s) => s.flags.length === 0)).toBe(true);
		expect(route.segments[0]).toMatchObject({ fromSeq: 1, toSeq: 2 });
		expect(route.qualityFlags).toContain("shape-from-stops");
	});

	it("출처, 지역, 시간 정보를 싣는다", () => {
		const route = assembleOk({
			info: { firstBusMinute: 360, headwayMin: 10, lastBusMinute: 1390 },
			route: GBIS_ROUTE,
			source: "gbis",
			stops: gbisStops(GBIS_ROUTE.routeId),
		});
		expect(route).toMatchObject({
			areaName: "고양",
			firstBusMinute: 360,
			headwayMin: 10,
			lastBusMinute: 1390,
			region: "gyeonggi",
			routeId: "241308701",
			routeName: "011",
			routeType: "30",
			shortName: "011",
			source: "gbis",
			sourceCity: null,
		});
		// 정류장 ID는 원본 그대로 둔다. 접두사는 참조 API에서 붙인다.
		expect(route.stops[0]?.stationId).toBe("218000033");
	});

	it("TAGO 노선은 인천 지역이고 도시 코드를 싣는다", () => {
		const route = assembleOk({
			info: null,
			route: TAGO_ROUTE,
			source: "tago",
			stops: [stop(1, 126.67, 37.4), stop(2, 126.68, 37.41)],
		});
		expect(route).toMatchObject({
			areaName: "인천",
			firstBusMinute: null,
			headwayMin: null,
			region: "incheon",
			source: "tago",
			sourceCity: "23",
		});
	});

	it("TAGO 경유 정류장 원본(101개, 상·하행)을 그대로 조립한다", () => {
		const result = assembleRegionalSource({
			raws: new Map([
				[
					TAGO_ROUTE.routeId,
					{
						infoBody: fixtureText("tago-route-info.json"),
						stationsBody: fixtureText("tago-route-stations.json"),
					},
				],
			]),
			routes: [TAGO_ROUTE],
			seoulRouteIds: new Set(),
			source: "tago",
		});
		expect(result.ok).toBe(true);
		const [route] = result.routes;
		expect(route?.coords).toHaveLength(101);
		expect(route).toMatchObject({
			headwayMin: 15,
			region: "incheon",
			source: "tago",
			sourceCity: "23",
		});
		expect(route?.stops[0]?.stationId).toBe("ICB364000795");
	});

	it("지역 이름은 regionName의 첫 시·군이다", () => {
		const list = parseGbisRouteList(
			JSON.parse(fixtureText("gbis-route-list-11.json"))
		);
		if (!list.ok) {
			throw new Error("ok여야 한다");
		}
		const row = list.items.find((item) => item.routeId === "236000050");
		if (!row) {
			throw new Error("236000050 행이 있어야 한다");
		}
		const route = assembleOk({
			info: null,
			route: row,
			source: "gbis",
			stops: [stop(1, 127.1, 37.6), stop(2, 127.11, 37.61)],
		});
		expect(route.areaName).toBe("구리");
	});

	it("정류장이 2개 미만이면 뺀다", () => {
		const result = assembleRegionalRoute({
			info: null,
			route: GBIS_ROUTE,
			source: "gbis",
			stops: [stop(1, 126.8, 37.6)],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issue.level).toBe("error");
		}
	});

	it("좌표가 0인 정류장이 있으면 뺀다", () => {
		const result = assembleRegionalRoute({
			info: null,
			route: GBIS_ROUTE,
			source: "gbis",
			stops: [stop(1, 126.8, 37.6), stop(2, 0, 0), stop(3, 126.82, 37.62)],
		});
		expect(result.ok).toBe(false);
	});

	it("순번이 겹치면 뺀다", () => {
		const result = assembleRegionalRoute({
			info: null,
			route: GBIS_ROUTE,
			source: "gbis",
			stops: [stop(1, 126.8, 37.6), stop(1, 126.81, 37.61)],
		});
		expect(result.ok).toBe(false);
	});
});

describe("dropSeoulDuplicates", () => {
	it("서울 노선 목록에 있는 GBIS 노선(M5107)을 버린다", () => {
		const m5107 = assembleOk({
			info: null,
			route: M5107_ROUTE,
			source: "gbis",
			stops: gbisStops(M5107_ROUTE.routeId),
		});
		const local = assembleOk({
			info: null,
			route: GBIS_ROUTE,
			source: "gbis",
			stops: gbisStops(GBIS_ROUTE.routeId),
		});
		const { dropped, kept } = dropSeoulDuplicates([m5107, local], {
			routeIds: new Set(["234001243", "100100290"]),
		});
		expect(dropped).toBe(1);
		expect(kept.map((route) => route.routeId)).toEqual(["241308701"]);
	});

	it("ICB 변환한 ID가 서울 노선이면 TAGO 노선을 버린다", () => {
		const twoStops = [stop(1, 126.67, 37.4), stop(2, 126.68, 37.41)];
		const seoulBound = assembleOk({
			info: null,
			route: { ...TAGO_ROUTE, routeId: "ICB365000215" },
			source: "tago",
			stops: twoStops,
		});
		// ICB 뒤 첫 자리가 2보다 작으면 변환하지 않는다(뺀 값이 음수가 된다).
		const lowPrefix = assembleOk({
			info: null,
			route: { ...TAGO_ROUTE, routeId: "ICB165000012" },
			source: "tago",
			stops: twoStops,
		});
		const local = assembleOk({
			info: null,
			route: TAGO_ROUTE,
			source: "tago",
			stops: twoStops,
		});
		const { dropped, kept } = dropSeoulDuplicates(
			[seoulBound, lowPrefix, local],
			{ routeIds: new Set(["165000215", "-165000012", "ICB165000012"]) }
		);
		expect(dropped).toBe(1);
		expect(kept.map((route) => route.routeId)).toEqual([
			"ICB165000012",
			"ICB365000085",
		]);
	});
});

describe("assembleRegionalSource", () => {
	const stationsBody = fixtureText("gbis-route-stations-241308701.json");
	const infoBody = fixtureText("gbis-route-info-241308701.json");
	const rows = (count: number): RegionalRouteRow[] =>
		Array.from({ length: count }, (_, i) => ({
			...GBIS_ROUTE,
			routeId: String(241_300_000 + i),
		}));

	it("받은 원본이 90% 이상이면 ok이고 시외·공항 유형은 세지 않는다", () => {
		const routes = [
			...rows(10),
			{ ...GBIS_ROUTE, routeId: "999000001", routeTypeCode: "43" },
		];
		const raws = new Map(
			routes
				.slice(0, 9)
				.map((route) => [route.routeId, { infoBody, stationsBody }])
		);
		const result = assembleRegionalSource({
			raws,
			routes,
			seoulRouteIds: new Set(),
			source: "gbis",
		});
		expect(regionalMinLoadableRatio).toBe(0.9);
		expect(result.ok).toBe(true);
		expect(result).toMatchObject({
			duplicates: 0,
			inScope: 10,
			loadable: 9,
			outOfScope: 1,
		});
		expect(result.missingRaw).toEqual(["241300009"]);
		expect(result.routes[0]?.headwayMin).toBe(10);
	});

	it("적재 가능한 노선이 90% 미만이면 ok가 아니다", () => {
		const routes = rows(10);
		const raws = new Map(
			routes
				.slice(0, 8)
				.map((route) => [route.routeId, { infoBody, stationsBody }])
		);
		const result = assembleRegionalSource({
			raws,
			routes,
			seoulRouteIds: new Set(),
			source: "gbis",
		});
		expect(result.loadable).toBe(8);
		expect(result.ok).toBe(false);
	});

	it("서울 노선과 겹치는 노선은 비율에 넣지 않는다", () => {
		const routes = rows(3);
		const raws = new Map([
			[routes[0]?.routeId ?? "", { infoBody, stationsBody }],
		]);
		// 겹치는 두 노선은 원본이 없어도 서울 쪽이 이기므로 빠진다.
		const result = assembleRegionalSource({
			raws,
			routes,
			seoulRouteIds: new Set([
				routes[1]?.routeId ?? "",
				routes[2]?.routeId ?? "",
			]),
			source: "gbis",
		});
		expect(result).toMatchObject({ duplicates: 2, inScope: 1, loadable: 1 });
		expect(result.ok).toBe(true);
	});

	it("노선 정보가 없어도 정류장이 있으면 적재하고, 결과 없음 정류장은 뺀다", () => {
		const routes = rows(2);
		const noData = JSON.stringify({
			response: { msgBody: {}, msgHeader: { resultCode: 4 } },
		});
		const raws = new Map([
			[routes[0]?.routeId ?? "", { stationsBody }],
			[routes[1]?.routeId ?? "", { infoBody, stationsBody: noData }],
		]);
		const result = assembleRegionalSource({
			raws,
			routes,
			seoulRouteIds: new Set(),
			source: "gbis",
		});
		expect(result.loadable).toBe(1);
		expect(result.routes[0]?.headwayMin).toBeNull();
		expect(result.excluded).toHaveLength(1);
		expect(result.excluded[0]?.routeId).toBe(routes[1]?.routeId);
	});

	it("목록 안에서 routeId가 겹치면 멈춘다", () => {
		expect(() =>
			assembleRegionalSource({
				raws: new Map(),
				routes: [GBIS_ROUTE, GBIS_ROUTE],
				seoulRouteIds: new Set(),
				source: "gbis",
			})
		).toThrow();
	});
});

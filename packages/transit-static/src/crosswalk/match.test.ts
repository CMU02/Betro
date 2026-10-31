import { describe, expect, it } from "bun:test";
import { matchStations } from "./match";

const lineNames = {
	stationMasterRoute: {
		"1호선": "line1",
		"2호선": "line2",
		"4호선": "line4",
		경의중앙선: "gyeongui-jungang",
	},
	stationSearchLineNum: {},
} as const;
const st = (
	statnId: string,
	subwayId: string,
	lineKey: string,
	nameRaw: string
) => ({ lineKey, lineNameRaw: "", nameRaw, statnId, subwayId }) as never;
const m = (
	bldnId: string,
	bldnNm: string,
	route: string,
	lat = 37.5,
	lng = 127.0
) => ({ bldnId, bldnNm, lat, lng, route });

describe("matchStations", () => {
	it("matches same line by normalized name", () => {
		const r = matchStations({
			aliases: [],
			lineNames,
			master: [
				m("0150", "서울", "1호선", 37.556, 126.972),
				m("0426", "서울", "4호선", 37.553, 126.97),
			],
			stations: [st("1001000133", "1001", "line1", "서울역")],
		});
		expect(r.unmatched).toEqual([]);
		expect(r.rows[0]).toMatchObject({
			bldnId: "0150",
			coordSource: "station-master",
			lat: 37.556,
			matchMethod: "auto-same-line",
			nameCanonical: "서울",
			statnId: "1001000133",
		});
		expect(r.rows[0]?.nameAliases).toEqual(["서울역", "서울"]);
	});
	it("falls back to a shared-station record on another route", () => {
		const r = matchStations({
			aliases: [],
			lineNames,
			master: [m("2628", "효창공원앞", "6호선")],
			stations: [st("1063000001", "1063", "gyeongui-jungang", "효창공원앞")],
		});
		expect(r.rows[0]?.matchMethod).toBe("auto-shared");
		expect(r.unmappedRoutes).toEqual([{ count: 1, route: "6호선" }]);
	});
	it("uses the manual alias table last", () => {
		const r = matchStations({
			aliases: [{ masterName: "원곡", statnId: "1001080176" }],
			lineNames,
			master: [m("1826", "원곡", "1호선")],
			stations: [st("1001080176", "1001", "line1", "시우")],
		});
		expect(r.rows[0]).toMatchObject({
			bldnId: "1826",
			matchMethod: "manual-alias",
		});
		expect(r.rows[0]?.nameAliases).toEqual(["시우", "원곡"]);
	});
	it("reports unmatched stations instead of throwing", () => {
		const r = matchStations({
			aliases: [],
			lineNames,
			master: [],
			stations: [st("1002000999", "1002", "line2", "없는역")],
		});
		expect(r.rows).toEqual([]);
		expect(r.unmatched.map((s) => s.statnId)).toEqual(["1002000999"]);
	});
	it("flags duplicate master records on the same line and keeps the first", () => {
		const r = matchStations({
			aliases: [],
			lineNames: {
				...lineNames,
				stationMasterRoute: {
					...lineNames.stationMasterRoute,
					"7호선": "line7",
				},
			},
			master: [
				m("2754", "까치울", "7호선", 37.506, 126.811),
				m("3754", "까치울", "7호선", 37.506, 126.811),
			],
			stations: [st("1007000754", "1007", "line7", "까치울")],
		});
		expect(r.rows[0]?.bldnId).toBe("2754");
		expect(r.rows[0]?.qualityFlags).toContain("duplicate-master");
	});
});

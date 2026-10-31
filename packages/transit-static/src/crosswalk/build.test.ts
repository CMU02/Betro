import { describe, expect, it } from "bun:test";
import { buildCrosswalk } from "./build";

describe("buildCrosswalk", () => {
	const base = {
		aliases: [],
		lineNames: {
			stationMasterRoute: { "1호선": "line1" },
			stationSearchLineNum: { "01호선": "line1" },
		},
		master: [
			{
				bldnId: "0150",
				bldnNm: "서울",
				lat: 37.556,
				lng: 126.972,
				route: "1호선",
			},
		],
		searchByName: new Map([
			[
				"서울역",
				[
					{
						frCode: "133",
						lineNum: "01호선",
						stationCd: "0150",
						stationNm: "서울",
					},
				],
			],
		]),
	} as const;
	const seoul = {
		lineKey: "line1",
		lineNameRaw: "1호선",
		nameRaw: "서울역",
		statnId: "1001000133",
		subwayId: "1001",
	} as const;
	it("is ok when everything matches and includes codes", () => {
		const r = buildCrosswalk({ ...base, stations: [seoul] } as never);
		expect(r.ok).toBe(true);
		expect(r.rows[0]).toMatchObject({ frCode: "133", stationCd: "0150" });
		expect(r.markdown).toContain("매칭 1 / 1");
	});
	it("is not ok with an unmatched station and lists it in markdown", () => {
		const r = buildCrosswalk({
			...base,
			stations: [seoul, { ...seoul, nameRaw: "없는역", statnId: "1001000134" }],
		} as never);
		expect(r.ok).toBe(false);
		expect(r.markdown).toContain("1001000134");
	});
	it("includes the edition diff when prevStations is given", () => {
		const r = buildCrosswalk({
			...base,
			prevStations: [],
			stations: [seoul],
		} as never);
		expect(r.diff?.added.length).toBe(1);
	});
});

import { describe, expect, it } from "bun:test";
import { attachStationCodes } from "./attach-codes";

const lineNames = {
	stationMasterRoute: {},
	stationSearchLineNum: {
		"03호선": "line3",
		"GTX-A": "gtx-a",
		서해선: "seohae",
	},
} as const;
const row = (statnId: string, lineKey: string, nameRaw: string) =>
	({
		bldnId: "",
		coordSource: "station-master",
		lat: 0,
		lineKey,
		lng: 0,
		matchMethod: "auto-same-line",
		nameAliases: [nameRaw],
		nameCanonical: nameRaw,
		qualityFlags: [],
		statnId,
		subwayId: "",
	}) as never;

describe("attachStationCodes", () => {
	const search = new Map([
		[
			"대곡",
			[
				{
					frCode: "S11",
					lineNum: "서해선",
					stationCd: "103C",
					stationNm: "대곡",
				},
				{
					frCode: "314",
					lineNum: "03호선",
					stationCd: "1953",
					stationNm: "대곡",
				},
				{
					frCode: "X103",
					lineNum: "GTX-A",
					stationCd: "9002",
					stationNm: "대곡",
				},
			],
		],
	]);
	it("picks the row whose LINE_NUM maps to the station's lineKey", () => {
		const r = attachStationCodes(
			[row("1003000314", "line3", "대곡")],
			search,
			lineNames
		);
		expect(r.rows[0]).toMatchObject({ frCode: "314", stationCd: "1953" });
		expect(r.missingCodes).toEqual([]);
	});
	it("keeps the row and flags it when no code matches", () => {
		const r = attachStationCodes(
			[row("1063000001", "gyeongui-jungang", "대곡")],
			search,
			lineNames
		);
		expect(r.rows[0]?.stationCd).toBeUndefined();
		expect(r.rows[0]?.qualityFlags).toContain("no-station-cd");
		expect(r.missingCodes).toEqual(["1063000001"]);
	});
	it("counts LINE_NUM values that are not in the manual table", () => {
		const r = attachStationCodes(
			[row("1001000001", "line1", "수원")],
			new Map([
				[
					"수원",
					[
						{
							frCode: "P155",
							lineNum: "경부선",
							stationCd: "1",
							stationNm: "수원",
						},
					],
				],
			]),
			lineNames
		);
		expect(r.unmappedLineNums).toEqual([{ count: 1, lineNum: "경부선" }]);
	});
});

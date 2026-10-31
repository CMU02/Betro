import { describe, expect, it } from "bun:test";
import { type KricRow, parseKricSheet } from "./kric-file";
import { parseKricKorailRows } from "./kric-korail-rows";

const HEADER = [
	"열차번호",
	"노선번호",
	"노선명",
	"운행구간기점명",
	"운행구간종점명",
	"운행유형",
	"요일구분",
	"운행구간정거장",
	"정거장도착시각",
	"정가장출발시각",
	"운행속도",
	"운영기관전화번호",
	"데이터기준일자",
];
const MISSING_HEADER = /missing header/;
const DATA_DATE = new Date("2026-05-31T00:00:00.000Z");

function clock(time: string): Date {
	return new Date(`1899-12-30T${time}.000Z`);
}

function sheetRow(
	trainNo: string,
	lineName: string,
	origin: string,
	destination: string,
	type: string,
	day: string,
	station: string,
	arrive: string,
	depart: string
): unknown[] {
	return [
		trainNo,
		"I4101",
		lineName,
		origin,
		destination,
		type,
		day,
		station,
		clock(arrive),
		clock(depart),
		null,
		"1544-5005",
		DATA_DATE,
	];
}

function gyeonguiRows(
	trainNo: string,
	day: string,
	origin: string,
	destination: string,
	type = "일반"
): KricRow[] {
	return parseKricSheet([
		HEADER,
		sheetRow(
			trainNo,
			"경의중앙선",
			origin,
			destination,
			type,
			day,
			origin,
			"05:00:00",
			"05:00:00"
		),
		sheetRow(
			trainNo,
			"경의중앙선",
			origin,
			destination,
			type,
			day,
			"공덕",
			"05:03:00",
			"05:03:30"
		),
		sheetRow(
			trainNo,
			"경의중앙선",
			origin,
			destination,
			type,
			day,
			destination,
			"05:10:00",
			"05:10:00"
		),
	]);
}

describe("parseKricSheet", () => {
	it("reads columns by header name and converts excel times to HH:MM:SS", () => {
		const [first] = gyeonguiRows("K1001", "평일", "덕소", "문산");
		expect(first).toMatchObject({
			arrive: "05:00:00",
			dataDate: "2026-05-31",
			dayLabel: "평일",
			depart: "05:00:00",
			destination: "문산",
			lineName: "경의중앙선",
			operator: "1544-5005",
			origin: "덕소",
			serviceType: "일반",
			stationName: "덕소",
			trainNo: "K1001",
		});
		expect(first?.raw.노선번호).toBe("I4101");
	});

	it("throws when a required header is missing", () => {
		expect(() => parseKricSheet([["열차번호"]])).toThrow(MISSING_HEADER);
	});
});

describe("parseKricKorailRows", () => {
	it("builds a trip with ordered stops and up direction from the destination", () => {
		const { trips, errors, sourceVersion } = parseKricKorailRows(
			gyeonguiRows("K1001", "평일", "덕소", "문산")
		);
		expect(errors).toEqual([]);
		expect(sourceVersion).toBe("2026-05-31");
		expect(trips).toHaveLength(1);
		const [trip] = trips;
		expect(trip).toMatchObject({
			direction: "up",
			express: "local",
			lineKey: "gyeongui-jungang",
			serviceDay: "weekday",
			serviceDaySource: "source",
			source: "kric-korail",
			sourceVersion: "2026-05-31",
			trainNo: "K1001",
		});
		expect(
			trip?.stops.map((s) => [s.seq, s.station.name, s.arrive, s.depart])
		).toEqual([
			[1, "덕소", "05:00:00", "05:00:00"],
			[2, "공덕", "05:03:00", "05:03:30"],
			[3, "문산", "05:10:00", "05:10:00"],
		]);
	});

	it("judges the opposite direction as down and marks 급행 as express", () => {
		const { trips } = parseKricKorailRows(
			gyeonguiRows("K1002", "평일", "문산", "덕소", "급행")
		);
		expect(trips[0]?.direction).toBe("down");
		expect(trips[0]?.express).toBe("express");
	});

	it("copies holiday trips as saturday with holiday-copied", () => {
		const { trips } = parseKricKorailRows(
			gyeonguiRows("K2001", "휴일", "덕소", "문산")
		);
		expect(trips.map((t) => [t.serviceDay, t.serviceDaySource])).toEqual([
			["holiday", "source"],
			["saturday", "holiday-copied"],
		]);
		expect(trips[1]?.trainNo).toBe("K2001");
		expect(trips[1]?.stops).toHaveLength(3);
	});

	it("does not copy holiday when saturday exists in the source", () => {
		const { trips } = parseKricKorailRows([
			...gyeonguiRows("K2001", "휴일", "덕소", "문산"),
			...gyeonguiRows("K2002", "토요일", "덕소", "문산"),
		]);
		expect(trips.filter((t) => t.serviceDay === "saturday")).toHaveLength(1);
		expect(trips.some((t) => t.serviceDaySource === "holiday-copied")).toBe(
			false
		);
	});

	it("reports an unknown terminal in errors and does not guess up", () => {
		const { trips, errors } = parseKricKorailRows(
			gyeonguiRows("K3001", "평일", "어딘가", "모르는역")
		);
		expect(trips).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("direction-unknown");
	});

	it("uses the origin to break the tie for 임진강 to 문산 (down)", () => {
		const { trips } = parseKricKorailRows(
			gyeonguiRows("K4001", "평일", "임진강", "문산")
		);
		expect(trips[0]?.direction).toBe("down");
	});

	it("handles 서해선 and ignores lines that are not Korail row-format lines", () => {
		const { trips } = parseKricKorailRows(
			parseKricSheet([
				HEADER,
				sheetRow(
					"K7101",
					"서해선",
					"일산",
					"원시",
					"일반",
					"평일",
					"일산",
					"05:00:00",
					"05:00:00"
				),
				sheetRow(
					"K7101",
					"서해선",
					"일산",
					"원시",
					"일반",
					"평일",
					"원시",
					"05:40:00",
					"05:40:00"
				),
				sheetRow(
					"K9",
					"경부선",
					"서울",
					"천안",
					"일반",
					"평일",
					"서울",
					"05:00:00",
					"05:00:00"
				),
			])
		);
		expect(trips).toHaveLength(1);
		expect(trips[0]?.lineKey).toBe("seohae");
		expect(trips[0]?.direction).toBe("down");
	});
});

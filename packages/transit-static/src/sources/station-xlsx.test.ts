import { describe, expect, it } from "bun:test";
import { parseStationRows, stationXlsxUrl } from "./station-xlsx";

describe("parseStationRows", () => {
	const header = ["SUBWAY_ID", "STATN_ID", "STATN_NM", "호선이름"];
	it("keeps ids as 10-digit strings even when cells are numbers", () => {
		const { rows, errors } = parseStationRows([
			header,
			[1001, 1_001_000_133, "서울", "1호선"],
		]);
		expect(errors).toEqual([]);
		expect(rows[0]).toEqual({
			lineKey: "line1",
			lineNameRaw: "1호선",
			nameRaw: "서울",
			statnId: "1001000133",
			subwayId: "1001",
		});
	});
	it("finds columns by header name regardless of order", () => {
		const { rows } = parseStationRows([
			["STATN_NM", "호선이름", "STATN_ID", "SUBWAY_ID"],
			["신림", "신림선", "1094000001", "1094"],
		]);
		expect(rows[0]?.lineKey).toBe("sillim");
	});
	it("reports unknown subwayId and drops the row", () => {
		const { rows, errors } = parseStationRows([
			header,
			["1999", "1999000001", "어딘가", "없는선"],
		]);
		expect(rows).toEqual([]);
		expect(errors[0]).toContain("1999");
	});
	it("trims whitespace in names", () => {
		const { rows } = parseStationRows([
			header,
			["1002", "1002000211", " 성수 ", "2호선"],
		]);
		expect(rows[0]?.nameRaw).toBe("성수");
	});
});

describe("stationXlsxUrl", () => {
	it("embeds seq", () => {
		expect(stationXlsxUrl(57)).toContain("seq=57");
		expect(stationXlsxUrl(57)).toContain("infId=OA-12764");
	});
});

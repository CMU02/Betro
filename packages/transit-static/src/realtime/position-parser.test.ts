import { describe, expect, it } from "bun:test";
import { parseRealtimePosition } from "./position-parser";

const row = (overrides: Record<string, unknown> = {}) => ({
	directAt: "0",
	lastRecptnDt: "20261030",
	lstcarAt: "0",
	recptnDt: "2026-10-30 20:55:18",
	rowNum: 1,
	selectedCount: 2,
	statnId: "1001000133",
	statnNm: "서울역",
	statnTid: "1001000134",
	statnTnm: "시청",
	subwayId: "1001",
	subwayNm: "1호선",
	totalCount: 2,
	trainNo: "0123",
	trainSttus: "1",
	updnLine: "0",
	...overrides,
});

const success = (rows: unknown[]) => ({
	errorMessage: {
		code: "INFO-000",
		developerMessage: "",
		link: "",
		message: "정상 처리되었습니다.",
		status: 200,
		total: rows.length,
	},
	realtimePositionList: rows,
});

describe("parseRealtimePosition", () => {
	it("parses a success envelope and maps updnLine to direction", () => {
		const result = parseRealtimePosition(
			success([row(), row({ trainNo: "0124", updnLine: "1" })])
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.rows).toHaveLength(2);
		expect(result.total).toBe(2);
		expect(result.rows[0]?.direction).toBe("up");
		expect(result.rows[1]?.direction).toBe("down");
		expect(result.rows[0]?.lineKey).toBe("line1");
		expect(result.rows[0]?.statnId).toBe("1001000133");
	});

	it("returns the code of a failure envelope", () => {
		const result = parseRealtimePosition({
			code: "INFO-200",
			developerMessage: "",
			link: "",
			message: "해당하는 데이터가 없습니다.",
			status: 500,
			total: 0,
		});
		expect(result).toEqual({
			code: "INFO-200",
			message: "해당하는 데이터가 없습니다.",
			ok: false,
		});
	});

	it("drops rows with an unknown subwayId and counts them", () => {
		const result = parseRealtimePosition(
			success([row(), row({ subwayId: "9999" })])
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.rows).toHaveLength(1);
		expect(result.dropped).toBe(1);
	});

	it("returns MALFORMED instead of throwing on a bad shape", () => {
		expect(parseRealtimePosition("nope")).toMatchObject({
			code: "MALFORMED",
			ok: false,
		});
		expect(
			parseRealtimePosition(success([row({ updnLine: "9" })]))
		).toMatchObject({ code: "MALFORMED", ok: false });
	});
});

import { describe, expect, it } from "bun:test";
import { timetableTrainNoKey, trainNoCandidates } from "./train-no-rules";

describe("trainNoCandidates", () => {
	it("line1 strips the K/S prefix and pads to 4 digits", () => {
		expect(trainNoCandidates("line1", "S186")?.candidates).toEqual(["0186"]);
		expect(trainNoCandidates("line1", "K802")?.candidates).toEqual(["0802"]);
		expect(trainNoCandidates("line1", "0473")?.candidates).toEqual(["0473"]);
	});
	it("line3 also tries the K suffix", () => {
		expect(trainNoCandidates("line3", "3002")?.candidates).toEqual([
			"3002",
			"3002K",
		]);
	});
	it("lines 5 to 8 keep the number", () => {
		for (const lineKey of ["line5", "line6", "line7", "line8"] as const) {
			expect(trainNoCandidates(lineKey, "5104")?.candidates).toEqual(["5104"]);
		}
	});
	it("line4 also tries the K prefix", () => {
		expect(trainNoCandidates("line4", "4327")?.candidates).toEqual([
			"4327",
			"K4327",
		]);
	});
	it("line9 tries C and E unless express is known", () => {
		expect(trainNoCandidates("line9", "9207")?.candidates).toEqual([
			"C9207",
			"E9207",
		]);
		expect(
			trainNoCandidates("line9", "9207", { express: true })?.candidates
		).toEqual(["E9207"]);
		expect(
			trainNoCandidates("line9", "9207", { express: false })?.candidates
		).toEqual(["C9207"]);
	});
	it("line2 keeps branch numbers and rewrites main line numbers", () => {
		expect(trainNoCandidates("line2", "1628")).toEqual({
			branchHint: "branch",
			candidates: ["1628"],
			rule: expect.any(String),
		});
		expect(trainNoCandidates("line2", "5631")?.branchHint).toBe("branch");
		expect(trainNoCandidates("line2", "5631")?.candidates).toEqual(["5631"]);
		expect(trainNoCandidates("line2", "3294")).toEqual({
			branchHint: "main",
			candidates: ["2294"],
			rule: expect.any(String),
		});
	});
	it("Korail lines try the K prefix first", () => {
		for (const lineKey of [
			"gyeongui-jungang",
			"suin-bundang",
			"gyeongchun",
			"seohae",
			"gyeonggang",
		] as const) {
			expect(trainNoCandidates(lineKey, "5082")?.candidates).toEqual([
				"K5082",
				"5082",
			]);
		}
	});
	it("airport, ui-sinseol and sillim keep the number", () => {
		expect(trainNoCandidates("airport", "A2161")?.candidates).toEqual([
			"A2161",
		]);
		expect(trainNoCandidates("ui-sinseol", "1290")?.candidates).toEqual([
			"1290",
		]);
		expect(trainNoCandidates("sillim", "1193")?.candidates).toEqual(["1193"]);
	});
	it("has no rule for shinbundang and gtx-a", () => {
		expect(trainNoCandidates("shinbundang", "2")).toBeNull();
		expect(trainNoCandidates("gtx-a", "0069")).toBeNull();
	});
});

describe("timetableTrainNoKey", () => {
	it("normalizes line1 timetable numbers the way line1 realtime numbers are", () => {
		expect(timetableTrainNoKey("line1", "K802")).toBe("0802");
		expect(timetableTrainNoKey("line1", "S2")).toBe("0002");
	});
	it("keeps other lines' timetable numbers", () => {
		expect(timetableTrainNoKey("line3", "3024K")).toBe("3024K");
		expect(timetableTrainNoKey("line9", "C9014")).toBe("C9014");
	});
});

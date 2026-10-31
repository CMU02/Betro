import { describe, expect, it } from "bun:test";
import { LINES, lineKeyBySubwayId } from "./lines";

describe("LINES", () => {
	it("has exactly 19 lines with unique keys and subwayIds", () => {
		expect(LINES.length).toBe(19);
		expect(new Set(LINES.map((l) => l.lineKey)).size).toBe(19);
		expect(new Set(LINES.map((l) => l.subwayId)).size).toBe(19);
	});
	it("maps realtime subwayIds", () => {
		expect(lineKeyBySubwayId("1002")).toBe("line2");
		expect(lineKeyBySubwayId("1032")).toBe("gtx-a");
		expect(lineKeyBySubwayId("1094")).toBe("sillim");
		expect(lineKeyBySubwayId("1081")).toBe("gyeonggang");
		expect(lineKeyBySubwayId("9999")).toBeUndefined();
	});
});

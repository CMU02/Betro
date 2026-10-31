import { describe, expect, it } from "bun:test";
import { diffStationLists } from "./diff";

const st = (statnId: string, nameRaw: string) =>
	({
		lineKey: "line1",
		lineNameRaw: "1호선",
		nameRaw,
		statnId,
		subwayId: "1001",
	}) as never;

describe("diffStationLists", () => {
	it("detects added, removed, and renamed stations by statnId", () => {
		const r = diffStationLists(
			[st("1", "가"), st("2", "나"), st("3", "다")],
			[st("2", "나"), st("3", "라"), st("4", "마")]
		);
		expect(r.added.map((s) => s.statnId)).toEqual(["4"]);
		expect(r.removed.map((s) => s.statnId)).toEqual(["1"]);
		expect(r.renamed).toEqual([{ from: "다", statnId: "3", to: "라" }]);
	});
});

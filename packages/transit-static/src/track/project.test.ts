import { describe, expect, it } from "bun:test";
import { lineLengthM, projectStations } from "./project";

// 위도 37.5에서 경도 0.01도는 약 884m
const line: [number, number][] = [
	[127.0, 37.5],
	[127.01, 37.5],
	[127.02, 37.5],
];

describe("projectStations", () => {
	it("measures distance from the line start and sorts along the line", () => {
		const r = projectStations(line, [
			{ lat: 37.5, lng: 127.02, statnId: "B" },
			{ lat: 37.5001, lng: 127.01, statnId: "A" },
		]);
		expect(r.offShape).toEqual([]);
		expect(r.onShape.map((s) => s.statnId)).toEqual(["A", "B"]);
		expect(r.onShape[0]?.distanceM).toBeCloseTo(lineLengthM(line) / 2, -1);
		expect(r.onShape[0]?.offsetM).toBeCloseTo(11.1, 0);
		expect(r.onShape[1]?.distanceM).toBeCloseTo(lineLengthM(line), -1);
	});
	it("puts stations farther than 150 m off the shape", () => {
		const r = projectStations(line, [
			{ lat: 37.502, lng: 127.01, statnId: "FAR" },
		]);
		expect(r.onShape).toEqual([]);
		expect(r.offShape[0]?.statnId).toBe("FAR");
		expect(r.offShape[0]?.offsetM).toBeGreaterThan(150);
	});
});

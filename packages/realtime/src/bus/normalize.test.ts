import { describe, expect, it } from "bun:test";
import bus6411 from "../__fixtures__/bus-6411.json";
import referenceFixture from "../__fixtures__/bus-reference-6411-150.json";
import type { BusReference, BusRouteRef } from "../reference";
import { kstToEpochMs } from "../time";
import {
	type BusPositionRow,
	parseBusPositions,
} from "../upstream/bus-position";
import { normalizeBusPositions } from "./normalize";

const loadReference = (): BusReference => {
	const routes = new Map<string, BusRouteRef>();
	for (const r of Object.values(referenceFixture.routes)) {
		routes.set(r.routeId, {
			coords: r.coords as [number, number][],
			lengthM: r.lengthM,
			routeId: r.routeId,
			segmentsBySeq: new Map(r.segments.map((s) => [s.fromSeq, s])),
		});
	}
	return { batchId: referenceFixture.batchId, routes };
};

const lineRef = (): BusReference => ({
	batchId: 1,
	routes: new Map([
		[
			"R",
			{
				// 경도 0.01도 ≈ 약 888m(위도 37도)이므로 충분히 긴 직선
				coords: [
					[127, 37],
					[127.1, 37],
				],
				lengthM: 8900,
				routeId: "R",
				segmentsBySeq: new Map([[4, { endM: 1601, fromSeq: 4, startM: 1000 }]]),
			},
		],
	]),
});

const row = (over: Partial<BusPositionRow> = {}): BusPositionRow => ({
	busType: "1",
	congetion: "3",
	dataTm: "20261103130000",
	fullSectDistM: 601,
	gpsX: 127.01,
	gpsY: 37,
	islastyn: false,
	isrunyn: true,
	lastStnId: "1",
	plainNo: "서울74사0001",
	sectDistM: 213,
	sectionId: "1",
	sectOrd: 4,
	stopFlag: false,
	vehId: "V1",
	...over,
});

describe("normalizeBusPositions", () => {
	it("computes distance on the segment", () => {
		const [o] = normalizeBusPositions("R", [row()], lineRef(), new Map(), 1);
		expect(o?.shapeDistanceM).toBeCloseTo(1213, 0);
	});

	it("matches the 6411 sample to phase 3 segments", () => {
		const parsed = parseBusPositions(bus6411);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			return;
		}
		const obs = normalizeBusPositions(
			"100100290",
			parsed.rows,
			loadReference(),
			new Map(),
			1
		);
		expect(obs).toHaveLength(parsed.rows.length);
		for (const o of obs) {
			expect(o.shapeDistanceM).not.toBeNull();
			expect(o.qualityFlags).not.toContain("unknown-segment");
		}
	});

	it("flags backwards and time-backwards", () => {
		const t = kstToEpochMs("20261103130000");
		const prev = new Map([["V1", { shapeDistanceM: 1500, sourceAt: t }]]);
		const [o] = normalizeBusPositions(
			"R",
			[row({ dataTm: "20261103125958" })],
			lineRef(),
			prev,
			1
		);
		expect(o?.qualityFlags).toContain("backwards");
		expect(o?.qualityFlags).toContain("time-backwards");
	});

	it("flags distance mismatch", () => {
		// 1213m 지점이어야 하는데 GPS는 약 1513m 지점(경도 127 + 1513/88800*... )
		const lngAt = (m: number) => 127 + m / 88_900;
		const [far] = normalizeBusPositions(
			"R",
			[row({ gpsX: lngAt(1513) })],
			lineRef(),
			new Map(),
			1
		);
		expect(far?.qualityFlags).toContain("distance-mismatch");
		const [near] = normalizeBusPositions(
			"R",
			[row({ gpsX: lngAt(1213) })],
			lineRef(),
			new Map(),
			1
		);
		expect(near?.qualityFlags).not.toContain("distance-mismatch");
	});

	it("handles zero, over, unknown segment and unknown route", () => {
		const ref = lineRef();
		const [zero] = normalizeBusPositions(
			"R",
			[row({ fullSectDistM: 0 })],
			ref,
			new Map(),
			1
		);
		expect(zero?.shapeDistanceM).toBe(1000);
		expect(zero?.qualityFlags).toContain("zero-full-sect");
		const [over] = normalizeBusPositions(
			"R",
			[row({ sectDistM: 900 })],
			ref,
			new Map(),
			1
		);
		expect(over?.shapeDistanceM).toBeCloseTo(1601, 3);
		expect(over?.qualityFlags).toContain("sect-dist-over");
		const [unk] = normalizeBusPositions(
			"R",
			[row({ sectOrd: 99 })],
			ref,
			new Map(),
			1
		);
		expect(unk?.shapeDistanceM).toBeNull();
		expect(unk?.qualityFlags).toContain("unknown-segment");
		const [none] = normalizeBusPositions("X", [row()], ref, new Map(), 1);
		expect(none?.qualityFlags).toContain("unknown-route");
	});
});

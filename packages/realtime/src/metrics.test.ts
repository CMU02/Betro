import { describe, expect, it } from "bun:test";
import { emptyBudget } from "./budget";
import {
	buildDailyReport,
	buildStatus,
	countByLine,
	METRICS_BUCKET_MS,
	type MetricsBucket,
	recordCall,
	type SourceProgress,
	sourceHealth,
} from "./metrics";
import type { BusObservation, SubwayObservation } from "./observation";
import { devConfig } from "./schedule";
import { kstToEpochMs } from "./time";

const config = devConfig({});
const MINUTE = 60_000;
const DAY = 86_400_000;

function subway(over: Partial<SubwayObservation> = {}): SubwayObservation {
	return {
		destinationStatnId: null,
		direction: "up",
		express: false,
		lastTrain: false,
		lineKey: "line2",
		matchStatus: "matched",
		observedAt: 0,
		qualityFlags: [],
		rawTrainNo: "2001",
		source: "arrival-all",
		sourceAt: null,
		sourceAtKind: "state-change",
		sourceAtRaw: "",
		stationDistanceM: null,
		statnId: "1002000201",
		status: "arrive",
		trackShapeId: null,
		tripId: 1,
		...over,
	};
}

function bus(over: Partial<BusObservation> = {}): BusObservation {
	return {
		busType: "1",
		congestion: "0",
		gpsProjectedDistanceM: null,
		lastTrip: false,
		lat: 37.5,
		lng: 127,
		observedAt: 0,
		plainNo: "서울74사1234",
		qualityFlags: [],
		routeId: "100100290",
		sectOrd: 1,
		shapeDistanceM: 100,
		sourceAt: 0,
		sourceAtRaw: "",
		stopped: false,
		vehId: "v1",
		...over,
	};
}

function bucketAt(
	bucketStart: number,
	source: "subway" | "bus",
	over: Partial<MetricsBucket> = {}
): MetricsBucket {
	return {
		backwards: 0,
		bucketStart,
		calls: 1,
		errors: {},
		matched: {},
		maxFreshnessMs: null,
		observed: {},
		source,
		unknownStations: 0,
		vehicles: {},
		...over,
	};
}

describe("source health", () => {
	it("health thresholds", () => {
		const noon = kstToEpochMs("2026-11-03 12:00:00");
		expect(sourceHealth(noon - 4 * MINUTE, noon, config)).toBe("ok");
		expect(sourceHealth(noon - 6 * MINUTE, noon, config)).toBe("delayed");
		expect(sourceHealth(noon - 16 * MINUTE, noon, config)).toBe("stalled");
		const twoAm = kstToEpochMs("2026-11-04 02:00:00");
		expect(sourceHealth(twoAm - 60 * MINUTE, twoAm, config)).toBe("off-hours");
	});

	it("measures from the start of operation when the last success is older", () => {
		const start = kstToEpochMs("2026-11-04 05:00:00");
		const yesterday = kstToEpochMs("2026-11-04 00:59:00");
		expect(sourceHealth(yesterday, start + MINUTE, config)).toBe("ok");
		expect(sourceHealth(null, start + 16 * MINUTE, config)).toBe("stalled");
		// 자정을 넘긴 00:30도 전날 05:00 운행 구간 안이다.
		const halfPast = kstToEpochMs("2026-11-04 00:30:00");
		expect(sourceHealth(halfPast - 2 * MINUTE, halfPast, config)).toBe("ok");
	});
});

describe("metrics buckets", () => {
	it("counts positioned trains, match rate only for lines with a rule", () => {
		const counts = countByLine([
			subway({ rawTrainNo: "2001" }),
			subway({ matchStatus: "no-timetable", rawTrainNo: "2002" }),
			// 99 행만 있던 열차: 위치를 모르니 차량 수에서 뺀다. 매칭 분모에는 들어간다.
			subway({
				qualityFlags: ["position-unknown"],
				rawTrainNo: "2003",
				statnId: null,
				status: null,
			}),
			subway({
				lineKey: "shinbundang",
				matchStatus: "no-timetable",
				qualityFlags: ["unknown-station"],
			}),
			bus({ qualityFlags: ["backwards"] }),
			bus({ vehId: "v2" }),
		]);
		expect(counts.line2).toEqual({
			backwards: 0,
			matched: 2,
			observed: 3,
			unknownStations: 0,
			vehicles: 2,
		});
		expect(counts.shinbundang).toMatchObject({
			observed: 0,
			unknownStations: 1,
		});
		expect(counts["100100290"]).toMatchObject({ backwards: 1, vehicles: 2 });
	});

	it("accumulates calls within a five minute bucket", () => {
		const t = kstToEpochMs("2026-11-03 12:01:00");
		const first = recordCall(undefined, t, "subway", "ok", [
			subway({ sourceAt: t - 20_000 }),
			subway({ rawTrainNo: "2002", sourceAt: t - 10_000 }),
		]);
		const second = recordCall(first, t + 80_000, "subway", "network", []);
		const third = recordCall(second, t + 160_000, "subway", "ok", [
			subway({ sourceAt: t + 100_000 }),
		]);
		expect(third.bucketStart).toBe(kstToEpochMs("2026-11-03 12:00:00"));
		expect(third.calls).toBe(3);
		expect(third.errors).toEqual({ network: 1 });
		expect(third.vehicles).toEqual({ line2: 2 });
		expect(third.matched).toEqual({ line2: 3 });
		expect(third.observed).toEqual({ line2: 3 });
		expect(third.maxFreshnessMs).toBe(60_000);
		expect(first.calls).toBe(1);
		const next = recordCall(third, t + 4 * MINUTE, "subway", "ok", []);
		expect(next.bucketStart).toBe(third.bucketStart + METRICS_BUCKET_MS);
		expect(next.calls).toBe(1);
	});
});

describe("collector status", () => {
	const progress = (lastSuccessAt: number | null): SourceProgress => ({
		errorsToday: { network: 2 },
		lastSourceAt: lastSuccessAt === null ? null : lastSuccessAt - 10_000,
		lastSuccessAt,
	});

	it("builds sources, lines and baseline", () => {
		const now = kstToEpochMs("2026-11-03 12:02:00");
		const slot = kstToEpochMs("2026-11-03 12:00:00");
		const recentBuckets = [
			bucketAt(slot - DAY, "subway", { vehicles: { line2: 40 } }),
			bucketAt(slot - 2 * DAY, "subway", { vehicles: { line2: 60 } }),
			bucketAt(slot, "subway", { vehicles: { line2: 25 } }),
			bucketAt(slot - 2 * DAY, "bus", { vehicles: { "100100290": 10 } }),
		];
		let budget = emptyBudget(now);
		budget = { ...budget, used: { bus: 100, subway: 300 } };
		const status = buildStatus({
			budget,
			config,
			lineCounts: countByLine([
				...Array.from({ length: 25 }, (_, i) =>
					subway({ rawTrainNo: String(2000 + i) })
				),
				bus(),
			]),
			now,
			recentBuckets,
			sources: {
				bus: progress(now - 16 * MINUTE),
				subway: progress(now - MINUTE),
			},
		});
		expect(status.overall).toBe("stalled");
		expect(status.sources.map((s) => [s.name, s.health])).toEqual([
			["subway", "ok"],
			["bus", "stalled"],
		]);
		expect(status.sources[0]).toMatchObject({
			errorsToday: { network: 2 },
			freshnessMs: 70_000,
			remainingToday: 600,
			usedToday: 300,
		});
		const line2 = status.lines.find((l) => l.key === "line2");
		expect(line2).toMatchObject({ matchRate: 1, vehicles: 25 });
		expect(line2?.baselineRatio).toBeCloseTo(0.5);
		expect(status.lines.find((l) => l.key === "shinbundang")).toMatchObject({
			baselineRatio: null,
			matchRate: null,
			vehicles: 0,
		});
		expect(status.lines.find((l) => l.key === "100100290")).toMatchObject({
			baselineRatio: 0.1,
			matchRate: null,
			vehicles: 1,
		});
		expect(status.lines.at(-1)?.key).toBe("100100029");
		expect(status.series).toHaveLength(1);
	});

	it("reports off-hours overall outside operating time", () => {
		const now = kstToEpochMs("2026-11-04 03:00:00");
		const status = buildStatus({
			budget: emptyBudget(now),
			config,
			lineCounts: {},
			now,
			recentBuckets: [],
			sources: { bus: progress(null), subway: progress(null) },
		});
		expect(status.overall).toBe("off-hours");
	});
});

describe("daily report", () => {
	function fullDay(
		skip: (t: number) => boolean = () => false
	): MetricsBucket[] {
		const out: MetricsBucket[] = [];
		const from = kstToEpochMs("2026-11-03 05:00:00");
		const to = kstToEpochMs("2026-11-04 01:00:00");
		for (let t = from; t < to; t += METRICS_BUCKET_MS) {
			if (!skip(t)) {
				out.push(
					bucketAt(t, "subway", {
						calls: 3,
						matched: { line2: 9, shinbundang: 0 },
						observed: { line2: 10 },
						vehicles: { line2: 50 },
					})
				);
			}
			out.push(bucketAt(t, "bus", { calls: 2, vehicles: { "100100290": 8 } }));
		}
		// 운행일 밖 버킷은 보고서에 들어가지 않는다.
		out.push(bucketAt(to + METRICS_BUCKET_MS, "subway", { calls: 999 }));
		return out;
	}

	it("daily report finds a stalled gap", () => {
		const gapFrom = kstToEpochMs("2026-11-03 10:00:00");
		const gapTo = kstToEpochMs("2026-11-03 10:20:00");
		const report = buildDailyReport(
			"2026-11-03",
			fullDay((t) => t >= gapFrom && t < gapTo),
			config
		);
		expect(report.stalledIntervals).toEqual([
			{ from: gapFrom, source: "subway", to: gapTo },
		]);
		expect(report.ok).toBe(false);
	});

	it("fails a day that lost history lines", () => {
		const full = { buffered: 10, written: 10 };
		const complete = {
			events: { bus: full, subway: full },
			raw: { bus: full, subway: full },
		};
		const lossy = {
			...complete,
			raw: { bus: full, subway: { buffered: 10, written: 8 } },
		};
		const report = buildDailyReport("2026-11-03", fullDay(), config, lossy);
		expect(report.history).toEqual(lossy);
		expect(report.ok).toBe(false);
		expect(buildDailyReport("2026-11-03", fullDay(), config, complete).ok).toBe(
			true
		);
		// 세지 못한 날(값 없음)은 이력으로 판정하지 않는다.
		const unknown = buildDailyReport("2026-11-03", fullDay(), config);
		expect(unknown.history).toBeNull();
		expect(unknown.ok).toBe(true);
	});

	it("passes a day without gaps", () => {
		const report = buildDailyReport("2026-11-03", fullDay(), config);
		expect(report.stalledIntervals).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.window).toEqual({
			from: kstToEpochMs("2026-11-03 05:00:00"),
			to: kstToEpochMs("2026-11-04 01:00:00"),
		});
		// 20시간 = 240칸.
		expect(report.calls).toEqual({ bus: 480, subway: 720 });
		const line2 = report.lines.find((l) => l.key === "line2");
		expect(line2).toEqual({ avgVehicles: 50, key: "line2", matchRate: 0.9 });
		expect(report.lines.find((l) => l.key === "shinbundang")).toEqual({
			avgVehicles: null,
			key: "shinbundang",
			matchRate: null,
		});
	});

	it("ignores short gaps and counts error-only buckets as missing", () => {
		const shortFrom = kstToEpochMs("2026-11-03 10:00:00");
		const failFrom = kstToEpochMs("2026-11-03 15:00:00");
		const failTo = kstToEpochMs("2026-11-03 15:15:00");
		const buckets = fullDay(
			(t) => t >= shortFrom && t < shortFrom + 2 * METRICS_BUCKET_MS
		).map((b) =>
			b.source === "subway" &&
			b.bucketStart >= failFrom &&
			b.bucketStart < failTo
				? { ...b, errors: { network: 3 } }
				: b
		);
		const report = buildDailyReport("2026-11-03", buckets, config);
		expect(report.stalledIntervals).toEqual([
			{ from: failFrom, source: "subway", to: failTo },
		]);
		expect(report.errors.subway).toEqual({ network: 9 });
	});

	it("fails when calls exceed the daily budget", () => {
		const buckets = fullDay().map((b) =>
			b.source === "bus" ? { ...b, calls: 5 } : b
		);
		expect(buildDailyReport("2026-11-03", buckets, config).ok).toBe(false);
	});
});

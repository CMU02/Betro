import {
	parseRealtimePosition,
	type RealtimeTrainRow,
} from "@Betro/transit-static/realtime/position-parser";
import { describe, expect, it } from "bun:test";
import arrivalSample from "../__fixtures__/arrival-all-sample.json";
import positionLine2 from "../__fixtures__/position-line2.json";
import positionLine7 from "../__fixtures__/position-line7.json";
import subwayReferenceSample from "../__fixtures__/subway-reference-sample.json";
import type { SubwayObservation } from "../observation";
import { buildSubwayReference, type SubwayReferenceRows } from "../reference";
import type { ArrivalRow } from "../upstream/subway-arrival";
import { parseStationArrivalAll } from "../upstream/subway-arrival";
import { normalizeArrivals, normalizePositions } from "./normalize";
import { reduceArrivals } from "./reduce-arrivals";

/** 표본을 받은 시각(2026-11-03 13:04:44.100 KST, 화요일). */
const SAMPLE_OBSERVED_AT = 1_793_678_684_100;
/** 2026-11-03 13:00:00 KST */
const NOON_TUESDAY = Date.UTC(2026, 10, 3, 4, 0, 0);
/** 2026-11-07(토) 00:30 KST → 서비스일은 2026-11-06(금) 평일. */
const SATURDAY_0030 = Date.UTC(2026, 10, 6, 15, 30, 0);
const MINUTE_MS = 60_000;
const STALE_GAP_MS = 200_000;

const baseRows: SubwayReferenceRows = {
	batchIds: { crosswalk: 1, timetable: 1, track: 1 },
	crosswalk: [
		{ lineKey: "line7", statnId: "S1" },
		{ lineKey: "line7", statnId: "S2" },
		{ lineKey: "line7", statnId: "S3" },
		{ lineKey: "line7", statnId: "NOTRACK" },
	],
	trackStations: ["S1", "S2", "S3"].map((statnId, seq) => ({
		branchKey: "main",
		direction: "down",
		distanceM: seq * 1000,
		lineKey: "line7",
		seq,
		statnId,
		trackShapeId: 1,
	})),
	trips: [
		{
			destinationStatnId: "S3",
			direction: "down",
			express: "local",
			id: 100,
			lineKey: "line7",
			originStatnId: "S1",
			serviceDay: "weekday",
			trainNo: "7001",
		},
		{
			destinationStatnId: "S3",
			direction: "down",
			express: "local",
			id: 201,
			lineKey: "line7",
			originStatnId: "S1",
			serviceDay: "weekday",
			trainNo: "7101",
		},
		{
			destinationStatnId: "S1",
			direction: "up",
			express: "local",
			id: 202,
			lineKey: "line7",
			originStatnId: "S3",
			serviceDay: "weekday",
			trainNo: "7101",
		},
		{
			destinationStatnId: "S3",
			direction: "down",
			express: "local",
			id: 301,
			lineKey: "line7",
			originStatnId: "S1",
			serviceDay: "weekday",
			trainNo: "7201",
		},
		{
			destinationStatnId: "S2",
			direction: "down",
			express: "local",
			id: 302,
			lineKey: "line7",
			originStatnId: "S1",
			serviceDay: "weekday",
			trainNo: "7201",
		},
	],
};
const ref = buildSubwayReference(baseRows);

const kst = (epochMs: number): string => {
	const d = new Date(epochMs + 9 * 3_600_000);
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

function arrival(overrides: Partial<ArrivalRow>): ArrivalRow {
	return {
		arvlCd: "1",
		bstatnId: "S3",
		btrainNo: "7001",
		btrainSttus: "일반",
		lstcarAt: "0",
		ordkey: "11000S30",
		recptnDt: kst(NOON_TUESDAY),
		statnFid: "",
		statnId: "S2",
		statnNm: "",
		statnTid: "",
		subwayId: "1007",
		updnLine: "하행",
		...overrides,
	};
}

function position(overrides: Partial<RealtimeTrainRow>): RealtimeTrainRow {
	return {
		directAt: "0",
		direction: "down",
		lastRecptnDt: "20261103",
		lineKey: "line7",
		lstcarAt: "0",
		recptnDt: kst(NOON_TUESDAY),
		statnId: "S2",
		statnNm: "",
		statnTid: "S3",
		statnTnm: "",
		subwayId: "1007",
		trainNo: "7001",
		trainSttus: "1",
		updnLine: "1",
		...overrides,
	};
}

function normalizeRows(
	rows: ArrivalRow[],
	observedAt: number,
	reference = ref
): SubwayObservation[] {
	return normalizeArrivals(
		reduceArrivals(rows, reference).trains,
		reference,
		observedAt
	);
}

describe("normalizeArrivals", () => {
	it("builds a matched observation on the track", () => {
		const [obs] = normalizeRows(
			[arrival({ lstcarAt: "1" })],
			NOON_TUESDAY + 20_000
		);
		expect(obs).toEqual({
			destinationStatnId: "S3",
			direction: "down",
			express: false,
			lastTrain: true,
			lineKey: "line7",
			matchStatus: "matched",
			observedAt: NOON_TUESDAY + 20_000,
			qualityFlags: [],
			rawTrainNo: "7001",
			source: "arrival-all",
			sourceAt: NOON_TUESDAY,
			sourceAtKind: "generated",
			sourceAtRaw: "2026-11-03 13:00:00",
			stationDistanceM: 1000,
			statnId: "S2",
			status: "arrive",
			trackShapeId: 1,
			tripId: 100,
		});
	});

	it("nulls a future recptnDt", () => {
		const raw = kst(NOON_TUESDAY + 3 * MINUTE_MS);
		const [obs] = normalizeRows(
			[arrival({ btrainNo: "6", recptnDt: raw, subwayId: "1077" })],
			NOON_TUESDAY
		);
		expect(obs?.sourceAt).toBeNull();
		expect(obs?.sourceAtRaw).toBe(raw);
		expect(obs?.qualityFlags).toContain("future-source-time");
		expect(obs?.lineKey).toBe("shinbundang");
		expect(obs?.matchStatus).toBe("no-timetable");
	});

	it("tolerates a few seconds of clock skew", () => {
		const [obs] = normalizeRows(
			[arrival({ recptnDt: kst(NOON_TUESDAY + 4000) })],
			NOON_TUESDAY
		);
		expect(obs?.sourceAt).toBe(NOON_TUESDAY + 4000);
		expect(obs?.qualityFlags).not.toContain("future-source-time");
	});

	it("flags stale rows", () => {
		const [obs] = normalizeRows([arrival({})], NOON_TUESDAY + STALE_GAP_MS);
		expect(obs?.sourceAt).toBe(NOON_TUESDAY);
		expect(obs?.qualityFlags).toContain("stale-source");
	});

	it("keeps an unparsable recptnDt as a flagged observation", () => {
		const [obs] = normalizeRows(
			[arrival({ recptnDt: "garbage" })],
			NOON_TUESDAY
		);
		expect(obs?.sourceAt).toBeNull();
		expect(obs?.sourceAtRaw).toBe("garbage");
		expect(obs?.qualityFlags).toContain("invalid-source-time");
	});

	it("matches with the previous service day after midnight", () => {
		const [obs] = normalizeRows(
			[arrival({ recptnDt: kst(SATURDAY_0030) })],
			SATURDAY_0030
		);
		expect(obs?.matchStatus).toBe("matched");
		expect(obs?.tripId).toBe(100);
	});

	it("does not match on a day without that trip", () => {
		/** 2026-11-07(토) 10:00 KST */
		const saturday = Date.UTC(2026, 10, 7, 1, 0, 0);
		const [obs] = normalizeRows(
			[arrival({ recptnDt: kst(saturday) })],
			saturday
		);
		expect(obs?.matchStatus).toBe("no-timetable");
		expect(obs?.tripId).toBeNull();
	});

	it("narrows several trips by direction, else ambiguous", () => {
		const [byDirection] = normalizeRows(
			[arrival({ btrainNo: "7101" })],
			NOON_TUESDAY
		);
		expect(byDirection).toMatchObject({ matchStatus: "matched", tripId: 201 });
		const [ambiguous] = normalizeRows(
			[arrival({ btrainNo: "7201" })],
			NOON_TUESDAY
		);
		expect(ambiguous).toMatchObject({ matchStatus: "ambiguous", tripId: null });
	});

	it("flags stations missing from the reference", () => {
		const [unknown] = normalizeRows(
			[arrival({ statnId: "ZZZ" })],
			NOON_TUESDAY
		);
		expect(unknown).toMatchObject({
			stationDistanceM: null,
			statnId: "ZZZ",
			trackShapeId: null,
		});
		expect(unknown?.qualityFlags).toContain("unknown-station");
		const [offTrack] = normalizeRows(
			[arrival({ statnId: "NOTRACK" })],
			NOON_TUESDAY
		);
		expect(offTrack?.qualityFlags).toContain("no-track-station");
		expect(offTrack?.qualityFlags).not.toContain("unknown-station");
	});

	it("keeps unknown-position trains with a flag", () => {
		const observations = normalizeRows(
			[arrival({ arvlCd: "99", statnId: "S1" })],
			NOON_TUESDAY
		);
		expect(observations).toHaveLength(1);
		expect(observations[0]).toMatchObject({
			stationDistanceM: null,
			statnId: null,
			status: null,
			trackShapeId: null,
		});
		expect(observations[0]?.qualityFlags).toContain("position-unknown");
	});

	it("carries conflicting-rows into the observation", () => {
		const [obs] = normalizeRows(
			[
				arrival({ arvlCd: "1", statnId: "S1" }),
				arrival({ arvlCd: "1", statnId: "S3" }),
			],
			NOON_TUESDAY,
			buildSubwayReference({
				...baseRows,
				trackStations: ["S1", "X1", "X2", "S3"].map((statnId, seq) => ({
					branchKey: "main",
					direction: "down",
					distanceM: seq * 1000,
					lineKey: "line7",
					seq,
					statnId,
					trackShapeId: 1,
				})),
			})
		);
		expect(obs?.statnId).toBe("S3");
		expect(obs?.qualityFlags).toContain("conflicting-rows");
	});
});

describe("normalizePositions", () => {
	it("maps trainSttus and keeps state-change time", () => {
		const statuses = (["0", "1", "2", "3"] as const).map(
			(trainSttus) =>
				normalizePositions([position({ trainSttus })], ref, NOON_TUESDAY)[0]
					?.status
		);
		expect(statuses).toEqual(["approach", "arrive", "depart", "prev-depart"]);
		const [obs] = normalizePositions([position({})], ref, NOON_TUESDAY);
		expect(obs).toMatchObject({
			destinationStatnId: "S3",
			matchStatus: "matched",
			source: "position",
			sourceAtKind: "state-change",
			stationDistanceM: 1000,
			tripId: 100,
		});
	});

	it("marks shinbundang position times as snapshots", () => {
		const [obs] = normalizePositions(
			[position({ lineKey: "shinbundang", subwayId: "1077", trainNo: "6" })],
			ref,
			NOON_TUESDAY
		);
		expect(obs?.sourceAtKind).toBe("snapshot");
		expect(obs?.matchStatus).toBe("no-timetable");
	});
});

describe("fixtures", () => {
	const sampleRef = buildSubwayReference(subwayReferenceSample);
	const parsedAll = parseStationArrivalAll(arrivalSample);
	if (!parsedAll.ok) {
		throw new Error("arrival sample did not parse");
	}
	const allObs = normalizeArrivals(
		reduceArrivals(parsedAll.rows, sampleRef).trains,
		sampleRef,
		SAMPLE_OBSERVED_AT
	);
	const positionObs = (json: unknown): SubwayObservation[] => {
		const parsed = parseRealtimePosition(json);
		if (!parsed.ok) {
			throw new Error("position sample did not parse");
		}
		return normalizePositions(parsed.rows, sampleRef, SAMPLE_OBSERVED_AT);
	};
	const line2Obs = positionObs(positionLine2);
	const line7Obs = positionObs(positionLine7);

	const matched = (obs: SubwayObservation[]): number =>
		obs.filter((o) => o.matchStatus === "matched").length;
	const onLine = (obs: SubwayObservation[], lineKey: string) =>
		obs.filter((o) => o.lineKey === lineKey);

	it("line 7 arrival numbers are not joined to position numbers", () => {
		const allLine7 = onLine(allObs, "line7");
		const allTrainNos = new Set(
			parsedAll.rows.filter((r) => r.subwayId === "1007").map((r) => r.btrainNo)
		);
		expect(allLine7).toHaveLength(allTrainNos.size);
		expect(new Set(allLine7.map((o) => o.rawTrainNo))).toEqual(allTrainNos);
		expect(line7Obs).toHaveLength(positionLine7.realtimePositionList.length);
		const positionNos = new Set(line7Obs.map((o) => o.rawTrainNo));
		expect(positionNos).not.toEqual(allTrainNos);
		for (const obs of allLine7) {
			expect(obs.source).toBe("arrival-all");
		}
	});

	it("matches the sample trains to the timetable", () => {
		expect(matched(onLine(allObs, "line2"))).toBe(
			onLine(allObs, "line2").length
		);
		expect(matched(onLine(allObs, "line7"))).toBe(
			onLine(allObs, "line7").length
		);
		expect(matched(line2Obs)).toBe(line2Obs.length);
		expect(matched(line7Obs)).toBe(line7Obs.length);
		expect(matched(onLine(allObs, "shinbundang"))).toBe(0);
	});

	it("places every located sample train on the track", () => {
		for (const obs of [...allObs, ...line2Obs, ...line7Obs]) {
			if (obs.statnId !== null) {
				expect(obs.qualityFlags).not.toContain("unknown-station");
				expect(obs.trackShapeId).not.toBeNull();
			}
		}
	});

	it("flags shinbundang ALL times from the future", () => {
		const future = onLine(allObs, "shinbundang").filter((o) =>
			o.qualityFlags.includes("future-source-time")
		);
		expect(future.length).toBeGreaterThan(0);
	});
});

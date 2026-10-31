import type { ServiceDay } from "@Betro/db/schema/transit";
import type { LineKey } from "../lines";
import type { StopTime, Trip } from "./model";

/** 구간 소요시간이 같은 구간 중앙값의 이 배수 이상이거나 이 배수분의 1 미만이면 경고한다. */
export const SEGMENT_OUTLIER_FACTOR = 3;
/** 같은 구간 표본이 이보다 적으면 중앙값을 믿지 않고 건너뛴다. */
export const SEGMENT_MIN_SAMPLES = 3;
const MIN_STOPS = 2;

export interface TimetableIssue {
	code:
		| "unknown-station"
		| "non-monotonic"
		| "segment-outlier"
		| "empty-trip"
		| "duplicate-stop";
	detail: string;
	lineKey: LineKey;
	serviceDay: ServiceDay;
	severity: "error" | "warn";
	trainNo: string;
}

interface SegmentSample {
	durationSec: number;
	fromStatnId: string;
	toStatnId: string;
	trip: Trip;
}

const issueFor = (
	trip: Trip,
	severity: TimetableIssue["severity"],
	code: TimetableIssue["code"],
	detail: string
): TimetableIssue => ({
	code,
	detail,
	lineKey: trip.lineKey,
	serviceDay: trip.serviceDay,
	severity,
	trainNo: trip.trainNo,
});

const bySeq = (stops: StopTime[]): StopTime[] =>
	[...stops].sort((a, b) => a.seq - b.seq);

/** 정차 순서대로 도착·출발 시각을 펼쳐, 처음 줄어드는 지점을 찾는다. */
function firstBackwardStep(stops: StopTime[]): string | undefined {
	let previous: { sec: number; seq: number } | undefined;
	for (const stop of stops) {
		for (const sec of [stop.arriveSec, stop.departSec]) {
			if (sec === null) {
				continue;
			}
			if (previous && sec < previous.sec) {
				return `seq ${previous.seq} ${previous.sec}s -> seq ${stop.seq} ${sec}s`;
			}
			previous = { sec, seq: stop.seq };
		}
	}
	return undefined;
}

function tripIssues(
	trip: Trip,
	stops: StopTime[],
	knownStatnIds: ReadonlySet<string>
): TimetableIssue[] {
	const issues: TimetableIssue[] = [];
	if (stops.length < MIN_STOPS) {
		issues.push(
			issueFor(trip, "error", "empty-trip", `${stops.length} stop(s)`)
		);
	}
	for (const stop of stops) {
		if (!knownStatnIds.has(stop.statnId)) {
			issues.push(
				issueFor(
					trip,
					"error",
					"unknown-station",
					`seq ${stop.seq} statnId ${stop.statnId}`
				)
			);
		}
	}
	const backward = firstBackwardStep(stops);
	if (backward) {
		issues.push(issueFor(trip, "error", "non-monotonic", backward));
	}
	const seen = new Map<string, number>();
	for (const stop of stops) {
		seen.set(stop.statnId, (seen.get(stop.statnId) ?? 0) + 1);
	}
	for (const [statnId, count] of seen) {
		if (count > 1) {
			issues.push(
				issueFor(trip, "warn", "duplicate-stop", `${statnId} x${count}`)
			);
		}
	}
	return issues;
}

/** 인접 정차 사이 소요시간: 앞 역 출발(없으면 도착)부터 다음 역 도착(없으면 출발)까지. */
function segmentSamples(trip: Trip, stops: StopTime[]): SegmentSample[] {
	const samples: SegmentSample[] = [];
	for (let i = 1; i < stops.length; i += 1) {
		const from = stops[i - 1];
		const to = stops[i];
		if (!(from && to)) {
			continue;
		}
		const leave = from.departSec ?? from.arriveSec;
		const reach = to.arriveSec ?? to.departSec;
		if (leave === null || reach === null || reach < leave) {
			continue;
		}
		samples.push({
			durationSec: reach - leave,
			fromStatnId: from.statnId,
			toStatnId: to.statnId,
			trip,
		});
	}
	return samples;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[mid] ?? 0;
	}
	return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function segmentOutliers(samples: SegmentSample[]): TimetableIssue[] {
	const groups = new Map<string, SegmentSample[]>();
	for (const sample of samples) {
		const key = `${sample.trip.lineKey}|${sample.fromStatnId}|${sample.toStatnId}`;
		const group = groups.get(key);
		if (group) {
			group.push(sample);
		} else {
			groups.set(key, [sample]);
		}
	}
	const issues: TimetableIssue[] = [];
	for (const group of groups.values()) {
		if (group.length < SEGMENT_MIN_SAMPLES) {
			continue;
		}
		const mid = median(group.map((s) => s.durationSec));
		if (mid <= 0) {
			continue;
		}
		for (const sample of group) {
			const tooSlow = sample.durationSec >= mid * SEGMENT_OUTLIER_FACTOR;
			const tooFast = sample.durationSec < mid / SEGMENT_OUTLIER_FACTOR;
			if (tooSlow || tooFast) {
				issues.push(
					issueFor(
						sample.trip,
						"warn",
						"segment-outlier",
						`${sample.fromStatnId} -> ${sample.toStatnId} ${sample.durationSec}s (median ${mid}s)`
					)
				);
			}
		}
	}
	return issues;
}

/**
 * 24시 넘김 처리(normalizeTripTimes)를 마친 trip들을 검사한다.
 * error: 대응표에 없는 역, 시각 역행, 정차 1개 이하. warn: 같은 구간 중앙값 대비 소요시간 이상, 같은 역 중복 정차.
 */
export function validateTrips(
	trips: Trip[],
	knownStatnIds: ReadonlySet<string>
): TimetableIssue[] {
	const issues: TimetableIssue[] = [];
	const samples: SegmentSample[] = [];
	for (const trip of trips) {
		const stops = bySeq(trip.stops);
		issues.push(...tripIssues(trip, stops, knownStatnIds));
		samples.push(...segmentSamples(trip, stops));
	}
	issues.push(...segmentOutliers(samples));
	return issues;
}

import type { TrackDirection } from "@Betro/db/schema/transit";
import { type LineKey, lineKeyBySubwayId } from "@Betro/transit-static/lines";
import type { RealtimeTrainRow } from "@Betro/transit-static/realtime/position-parser";
import { trainNoCandidates } from "@Betro/transit-static/realtime/train-no-rules";
import type {
	SourceAtKind,
	SubwayObservation,
	SubwayStatus,
} from "../observation";
import {
	type StationOnTrack,
	type SubwayReference,
	type TripKey,
	tripLookupKey,
} from "../reference";
import { kstToEpochMs, serviceDayAt } from "../time";
import { arrivalDirection, type TrainCandidate } from "./reduce-arrivals";

/** 원천 시각이 받은 시각보다 이만큼 넘게 미래면 쓰지 않는다(시계 오차 허용). */
export const FUTURE_SOURCE_TOLERANCE_MS = 5000;
/** 받은 시각보다 이만큼 넘게 묵은 원천 시각은 `stale-source`. */
export const STALE_SOURCE_MS = 180_000;

/** 위치 API `trainSttus` → 상태. */
const POSITION_STATUS: Readonly<
	Record<RealtimeTrainRow["trainSttus"], SubwayStatus>
> = {
	"0": "approach",
	"1": "arrive",
	"2": "depart",
	"3": "prev-depart",
};

/** ALL `btrainSttus` 중 급행 계열. "일반"은 급행 아님, 그 밖의 값은 모름. */
const EXPRESS_TRAIN_STATUS: ReadonlySet<string> = new Set([
	"급행",
	"특급",
	"직통",
	"ITX",
]);
const LOCAL_TRAIN_STATUS = "일반";

function arrivalExpress(btrainSttus: string): boolean | undefined {
	if (EXPRESS_TRAIN_STATUS.has(btrainSttus)) {
		return true;
	}
	return btrainSttus === LOCAL_TRAIN_STATUS ? false : undefined;
}

/** 위치 API `directAt`: "1"(급행)·"7"(특급)은 급행, "0"은 아님, 그 밖은 모름. */
function positionExpress(directAt: string): boolean | undefined {
	if (directAt === "1" || directAt === "7") {
		return true;
	}
	return directAt === "0" ? false : undefined;
}

/** 원천 KST 시각 → epoch ms. 미래·묵음·해석 불가는 플래그로 남긴다. */
function sourceTime(
	raw: string,
	observedAt: number,
	flags: string[]
): number | null {
	let sourceAt: number;
	try {
		sourceAt = kstToEpochMs(raw);
	} catch {
		flags.push("invalid-source-time");
		return null;
	}
	if (sourceAt > observedAt + FUTURE_SOURCE_TOLERANCE_MS) {
		flags.push("future-source-time");
		return null;
	}
	if (observedAt - sourceAt > STALE_SOURCE_MS) {
		flags.push("stale-source");
	}
	return sourceAt;
}

interface TripMatch {
	branchHint?: "main" | "branch";
	matchStatus: SubwayObservation["matchStatus"];
	trip: TripKey | null;
}

/**
 * 실시간 열차번호를 관측 시각의 서비스일 시간표 trip에 잇는다(수집 설계 6.4).
 * 1건 matched, 0건 no-timetable, 여럿이면 같은 방향 1건으로 좁히고 그래도 여럿(또는 0)이면 ambiguous.
 */
function matchTrip(
	ref: SubwayReference,
	lineKey: LineKey,
	rawTrainNo: string,
	express: boolean | undefined,
	direction: TrackDirection,
	observedAt: number
): TripMatch {
	const match = trainNoCandidates(lineKey, rawTrainNo, { express });
	if (!match) {
		return { matchStatus: "no-timetable", trip: null };
	}
	const { serviceDay } = serviceDayAt(observedAt);
	const found = new Map<number, TripKey>();
	for (const candidate of match.candidates) {
		const trips =
			ref.tripsByLineDayNo.get(tripLookupKey(lineKey, serviceDay, candidate)) ??
			[];
		for (const trip of trips) {
			found.set(trip.tripId, trip);
		}
	}
	const { branchHint } = match;
	const trips = [...found.values()];
	if (trips.length === 0) {
		return { branchHint, matchStatus: "no-timetable", trip: null };
	}
	if (trips.length === 1) {
		return { branchHint, matchStatus: "matched", trip: trips[0] ?? null };
	}
	const sameDirection = trips.filter((trip) => trip.direction === direction);
	if (sameDirection.length === 1) {
		return {
			branchHint,
			matchStatus: "matched",
			trip: sameDirection[0] ?? null,
		};
	}
	return { branchHint, matchStatus: "ambiguous", trip: null };
}

/** 그 방향 모양 위의 역. 지선 열차는 지선 모양, 아니면 본선, 그다음 작은 모양 id를 고른다. */
function locate(
	entries: readonly StationOnTrack[],
	direction: TrackDirection,
	branchHint: "main" | "branch" | undefined
): StationOnTrack | null {
	const preferBranch = branchHint === "branch";
	let best: StationOnTrack | null = null;
	for (const entry of entries) {
		if (entry.direction !== direction) {
			continue;
		}
		if (!best) {
			best = entry;
			continue;
		}
		const isMain = entry.branchKey === "main";
		const bestIsMain = best.branchKey === "main";
		if (isMain !== bestIsMain) {
			if (isMain !== preferBranch) {
				best = entry;
			}
		} else if (entry.trackShapeId < best.trackShapeId) {
			best = entry;
		}
	}
	return best;
}

interface CommonInput {
	destinationStatnId: string;
	direction: TrackDirection | null;
	express: boolean | undefined;
	lastTrain: boolean;
	lineKey: LineKey;
	rawTrainNo: string;
	source: SubwayObservation["source"];
	sourceAtKind: SourceAtKind;
	sourceAtRaw: string;
	statnId: string | null;
	status: SubwayStatus | null;
}

function buildObservation(
	input: CommonInput,
	ref: SubwayReference,
	observedAt: number,
	initialFlags: readonly string[]
): SubwayObservation {
	const flags = [...initialFlags];
	const sourceAt = sourceTime(input.sourceAtRaw, observedAt, flags);
	// 방향을 모르면 up으로 두고 플래그를 단다(관측은 버리지 않는다).
	const direction: TrackDirection = input.direction ?? "up";
	if (input.direction === null) {
		flags.push("unknown-direction");
	}
	const { branchHint, matchStatus, trip } = matchTrip(
		ref,
		input.lineKey,
		input.rawTrainNo,
		input.express,
		direction,
		observedAt
	);
	let station: StationOnTrack | null = null;
	if (input.statnId !== null) {
		const entries = ref.stationsByStatnId.get(input.statnId);
		if (entries === undefined) {
			flags.push("unknown-station");
		} else {
			station = locate(entries, direction, branchHint);
			if (!station) {
				flags.push("no-track-station");
			}
		}
	}
	return {
		destinationStatnId:
			input.destinationStatnId || trip?.destinationStatnId || null,
		direction,
		express: input.express === true,
		lastTrain: input.lastTrain,
		lineKey: input.lineKey,
		matchStatus,
		observedAt,
		qualityFlags: flags,
		rawTrainNo: input.rawTrainNo,
		source: input.source,
		sourceAt,
		sourceAtKind: input.sourceAtKind,
		sourceAtRaw: input.sourceAtRaw,
		stationDistanceM: station?.distanceM ?? null,
		statnId: input.statnId,
		status: input.status,
		trackShapeId: station?.trackShapeId ?? null,
		tripId: trip?.tripId ?? null,
	};
}

/**
 * `reduceArrivals` 결과(ALL) → 관측. 원천 시각 종류는 `generated`.
 * 노선을 모르는 `subwayId`(LINES 밖)는 lineKey를 정할 수 없어 관측을 만들지 않는다.
 */
export function normalizeArrivals(
	trains: TrainCandidate[],
	ref: SubwayReference,
	observedAt: number
): SubwayObservation[] {
	const observations: SubwayObservation[] = [];
	for (const train of trains) {
		const lineKey = lineKeyBySubwayId(train.subwayId);
		if (!lineKey) {
			continue;
		}
		const { row } = train;
		observations.push(
			buildObservation(
				{
					destinationStatnId: row.bstatnId,
					direction: arrivalDirection(row.updnLine),
					express: arrivalExpress(row.btrainSttus),
					lastTrain: row.lstcarAt === "1",
					lineKey,
					rawTrainNo: train.btrainNo,
					source: "arrival-all",
					sourceAtKind: "generated",
					sourceAtRaw: row.recptnDt,
					statnId: train.statnId,
					status: train.status,
				},
				ref,
				observedAt,
				train.flags
			)
		);
	}
	return observations;
}

/** 위치 API(`prod`) 행 → 관측. 신분당선 시각은 `snapshot`, 나머지는 `state-change`. */
export function normalizePositions(
	rows: RealtimeTrainRow[],
	ref: SubwayReference,
	observedAt: number
): SubwayObservation[] {
	return rows.map((row) =>
		buildObservation(
			{
				destinationStatnId: row.statnTid,
				direction: row.direction,
				express: positionExpress(row.directAt),
				lastTrain: row.lstcarAt === "1",
				lineKey: row.lineKey,
				rawTrainNo: row.trainNo,
				source: "position",
				sourceAtKind:
					row.lineKey === "shinbundang" ? "snapshot" : "state-change",
				sourceAtRaw: row.recptnDt,
				statnId: row.statnId,
				status: POSITION_STATUS[row.trainSttus],
			},
			ref,
			observedAt,
			[]
		)
	);
}

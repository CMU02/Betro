import type {
	ExpressKind,
	ServiceDay,
	TrackDirection,
} from "@Betro/db/schema/transit";
import { isLineKey, type LineKey } from "@Betro/transit-static/lines";
import { timetableTrainNoKey } from "@Betro/transit-static/realtime/train-no-rules";

export interface StationOnTrack {
	branchKey: string;
	direction: TrackDirection;
	distanceM: number;
	lineKey: LineKey;
	seq: number;
	statnId: string;
	trackShapeId: number;
}

export interface TripKey {
	destinationStatnId?: string;
	direction: TrackDirection;
	express: ExpressKind;
	lineKey: LineKey;
	originStatnId?: string;
	serviceDay: ServiceDay;
	trainNo: string;
	tripId: number;
}

/** 선로 모양 하나의 역 수와 순환 여부. 순환선은 seq가 끝에서 0으로 이어진다. */
export interface TrackShapeInfo {
	loop: boolean;
	/** 그 모양에 놓인 역 수(최대 seq + 1). */
	stationCount: number;
}

export interface SubwayReference {
	batchIds: { crosswalk: number; track: number; timetable: number };
	/** `buildSubwayReference`가 채운다. 없으면 모든 모양을 순환이 아닌 것으로 본다. */
	shapes?: Map<number, TrackShapeInfo>;
	/** 대응표에만 있고 선로 위 역이 없는 역은 빈 배열. */
	stationsByStatnId: Map<string, StationOnTrack[]>;
	/** 키 `${lineKey}|${serviceDay}|${timetableTrainNoKey(lineKey, trainNo)}` */
	tripsByLineDayNo: Map<string, TripKey[]>;
}

/** 순환하는 선로 모양(2호선 본선). OSM 모양은 순환 여부를 따로 담지 않아 노선·가지로 정한다. */
const LOOP_BRANCHES: ReadonlySet<string> = new Set(["line2|main"]);

/** `tripsByLineDayNo`의 키. `trainNoKey`는 `timetableTrainNoKey`나 `trainNoCandidates`의 후보. */
export const tripLookupKey = (
	lineKey: LineKey,
	serviceDay: ServiceDay,
	trainNoKey: string
): string => `${lineKey}|${serviceDay}|${trainNoKey}`;

/** D1/libsql에서 읽은 행 그대로(문자열 열은 좁히지 않은 채)를 받는다. */
export interface SubwayReferenceRows {
	batchIds: SubwayReference["batchIds"];
	/** 현재 `station_crosswalk` 배치. */
	crosswalk: readonly { lineKey: string; statnId: string }[];
	/** 현재 `track` 배치의 `track_station` ⋈ `track_shape`. */
	trackStations: readonly {
		branchKey: string;
		direction: string;
		distanceM: number;
		lineKey: string;
		seq: number;
		statnId: string;
		trackShapeId: number;
	}[];
	/** 현재 `timetable` 배치의 `timetable_trip`(정차 시각은 넣지 않는다). */
	trips: readonly {
		destinationStatnId: string | null;
		direction: string;
		express: string;
		id: number;
		lineKey: string;
		originStatnId: string | null;
		serviceDay: string;
		trainNo: string;
	}[];
}

const isDirection = (value: string): value is TrackDirection =>
	value === "up" || value === "down";

const SERVICE_DAYS: ReadonlySet<string> = new Set([
	"weekday",
	"saturday",
	"holiday",
]);
const isServiceDay = (value: string): value is ServiceDay =>
	SERVICE_DAYS.has(value);

const EXPRESS_KINDS: ReadonlySet<string> = new Set([
	"local",
	"express",
	"special",
	"direct",
]);
const isExpressKind = (value: string): value is ExpressKind =>
	EXPRESS_KINDS.has(value);

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list) {
		list.push(value);
	} else {
		map.set(key, [value]);
	}
}

function indexStations(rows: SubwayReferenceRows): {
	shapes: Map<number, TrackShapeInfo>;
	stationsByStatnId: Map<string, StationOnTrack[]>;
} {
	const stationsByStatnId = new Map<string, StationOnTrack[]>();
	const shapes = new Map<number, TrackShapeInfo>();
	for (const row of rows.trackStations) {
		const { direction, lineKey } = row;
		if (!(isLineKey(lineKey) && isDirection(direction))) {
			continue;
		}
		pushTo(stationsByStatnId, row.statnId, {
			branchKey: row.branchKey,
			direction,
			distanceM: row.distanceM,
			lineKey,
			seq: row.seq,
			statnId: row.statnId,
			trackShapeId: row.trackShapeId,
		});
		const shape = shapes.get(row.trackShapeId);
		shapes.set(row.trackShapeId, {
			loop: LOOP_BRANCHES.has(`${lineKey}|${row.branchKey}`),
			stationCount: Math.max(shape?.stationCount ?? 0, row.seq + 1),
		});
	}
	for (const { statnId } of rows.crosswalk) {
		if (!stationsByStatnId.has(statnId)) {
			stationsByStatnId.set(statnId, []);
		}
	}
	return { shapes, stationsByStatnId };
}

function indexTrips(rows: SubwayReferenceRows): Map<string, TripKey[]> {
	const tripsByLineDayNo = new Map<string, TripKey[]>();
	for (const row of rows.trips) {
		const { direction, express, lineKey, serviceDay } = row;
		if (
			!(
				isLineKey(lineKey) &&
				isDirection(direction) &&
				isServiceDay(serviceDay) &&
				isExpressKind(express)
			)
		) {
			continue;
		}
		const trip: TripKey = {
			direction,
			express,
			lineKey,
			serviceDay,
			trainNo: row.trainNo,
			tripId: row.id,
		};
		if (row.originStatnId) {
			trip.originStatnId = row.originStatnId;
		}
		if (row.destinationStatnId) {
			trip.destinationStatnId = row.destinationStatnId;
		}
		pushTo(
			tripsByLineDayNo,
			tripLookupKey(
				lineKey,
				serviceDay,
				timetableTrainNoKey(lineKey, row.trainNo)
			),
			trip
		);
	}
	return tripsByLineDayNo;
}

/**
 * 현재 배치 행으로 정규화용 색인을 만든다. 노선·방향·요일 값이 알 수 없는 행은 건너뛴다.
 * 역은 seq 순으로 정렬하지 않아도 된다(정규화가 seq·distanceM만 비교한다).
 */
export function buildSubwayReference(
	rows: SubwayReferenceRows
): SubwayReference {
	const { shapes, stationsByStatnId } = indexStations(rows);
	return {
		batchIds: { ...rows.batchIds },
		shapes,
		stationsByStatnId,
		tripsByLineDayNo: indexTrips(rows),
	};
}

export interface BusSegmentRef {
	endM: number;
	fromSeq: number;
	startM: number;
}

export interface BusRouteRef {
	coords?: [number, number][];
	lengthM: number;
	routeId: string;
	segmentsBySeq: Map<number, BusSegmentRef>;
}

export interface BusReference {
	batchId: number;
	routes: Map<string, BusRouteRef>;
}

import type {
	ExpressKind,
	ServiceDay,
	TrackDirection,
} from "@Betro/db/schema/transit";
import type { LineKey } from "@Betro/transit-static/lines";

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

export interface SubwayReference {
	batchIds: { crosswalk: number; track: number; timetable: number };
	stationsByStatnId: Map<string, StationOnTrack[]>;
	/** 키 `${lineKey}|${serviceDay}|${timetableTrainNoKey(lineKey, trainNo)}` */
	tripsByLineDayNo: Map<string, TripKey[]>;
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

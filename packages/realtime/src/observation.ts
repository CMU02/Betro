import type { TrackDirection } from "@Betro/db/schema/transit";
import type { LineKey } from "@Betro/transit-static/lines";

export type SubwayStatus = "approach" | "arrive" | "depart" | "prev-depart";
export type SourceAtKind = "state-change" | "snapshot" | "generated";

export interface SubwayObservation {
	destinationStatnId: string | null;
	direction: TrackDirection;
	express: boolean;
	lastTrain: boolean;
	lineKey: LineKey;
	matchStatus: "matched" | "no-timetable" | "ambiguous";
	observedAt: number;
	qualityFlags: string[];
	rawTrainNo: string;
	source: "position" | "arrival-all";
	sourceAt: number | null;
	sourceAtKind: SourceAtKind;
	sourceAtRaw: string;
	stationDistanceM: number | null;
	statnId: string | null;
	status: SubwayStatus | null;
	trackShapeId: number | null;
	tripId: number | null;
}

export interface BusObservation {
	busType: string;
	congestion: string;
	gpsProjectedDistanceM: number | null;
	lastTrip: boolean;
	lat: number;
	lng: number;
	observedAt: number;
	plainNo: string;
	qualityFlags: string[];
	routeId: string;
	sectOrd: number;
	shapeDistanceM: number | null;
	sourceAt: number;
	sourceAtRaw: string;
	stopped: boolean;
	vehId: string;
}

import type {
	ExpressKind,
	ServiceDay,
	ServiceDaySource,
	TimetableSourceKind,
	TrackDirection,
} from "@Betro/db/schema/transit";
import type { LineKey } from "../lines";

/** 한 정차. 시각은 서비스일 0시 기준 초(24시 이후는 86,400 이상), 둘 중 하나는 null일 수 있다. */
export interface StopTime {
	arriveSec: number | null;
	departSec: number | null;
	qualityFlags: string[];
	seq: number;
	statnId: string;
}

/** 공통 시간표 모델의 열차 1편. trainNo는 출처의 원래 번호다. */
export interface Trip {
	destinationStatnId?: string;
	direction: TrackDirection;
	express: ExpressKind;
	lineKey: LineKey;
	originStatnId?: string;
	qualityFlags: string[];
	serviceDay: ServiceDay;
	serviceDaySource: ServiceDaySource;
	source: TimetableSourceKind;
	/** 출처 기준일. */
	sourceVersion: string;
	stops: StopTime[];
	trainNo: string;
}

/** 어댑터가 역을 해석하기 전 단계의 정차. 시각은 출처 원문 문자열이다. */
export interface SourceStop {
	arrive: string | null;
	depart: string | null;
	/** 어댑터가 원본에서 본 문제(예: "duplicate-stop"). Task 8이 StopTime.qualityFlags로 옮긴다. */
	qualityFlags?: string[];
	seq: number;
	station: { code?: string; name?: string };
}

/** 모든 어댑터의 출력. 역 해석과 시각 파싱을 거쳐 Trip이 된다. */
export type SourceTrip = Omit<Trip, "stops" | "sourceVersion"> & {
	sourceVersion?: string;
	stops: SourceStop[];
};

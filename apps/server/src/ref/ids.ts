import type { BusSource } from "@Betro/db/schema/transit";

/** 노선·정류장 ID 형식. 서울은 2-C `packages/commute/src/refs.ts`와 같다. */
const SUBWAY_PREFIX = "seoul-subway:";
const BUS_PREFIXES: Record<BusSource, string> = {
	gbis: "gbis:",
	seoul: "seoul-bus:",
	tago: "tago:",
};
/** 접두사 하나가 다른 접두사의 앞부분이 아니라서 순서와 상관없이 가려낸다. */
const BUS_SOURCES: BusSource[] = ["seoul", "gbis", "tago"];

export interface BusRef {
	id: string;
	source: BusSource;
}

export function busLine(source: BusSource, routeId: string): string {
	return `${BUS_PREFIXES[source]}${routeId}`;
}

export function busStop(source: BusSource, stationId: string): string {
	return `${BUS_PREFIXES[source]}${stationId}`;
}

/** 출처 접두사가 붙은 ID를 출처와 맨 값으로 나눈다. 접두사가 없으면 서울로 본다. */
export function parseBusRef(value: string): BusRef {
	for (const source of BUS_SOURCES) {
		const prefix = BUS_PREFIXES[source];
		if (value.startsWith(prefix)) {
			return { id: value.slice(prefix.length), source };
		}
	}
	return { id: value, source: "seoul" };
}

export function subwayLine(lineKey: string): string {
	return `${SUBWAY_PREFIX}${lineKey}`;
}

export function subwayStation(statnId: string): string {
	return `${SUBWAY_PREFIX}${statnId}`;
}

function stripPrefix(prefix: string, value: string): string {
	return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** 출처 구분 ID(`seoul-subway:…`)나 맨 값을 맨 값으로 돌려준다. */
export function stripSubwayPrefix(value: string): string {
	return stripPrefix(SUBWAY_PREFIX, value);
}

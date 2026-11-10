/** 노선·정류장 ID 형식. 2-C `packages/commute/src/refs.ts`와 같다. */
const BUS_PREFIX = "seoul-bus:";
const SUBWAY_PREFIX = "seoul-subway:";

export function busLine(busRouteId: string): string {
	return `${BUS_PREFIX}${busRouteId}`;
}

export function busStop(stId: string): string {
	return `${BUS_PREFIX}${stId}`;
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

/** 출처 구분 ID(`seoul-bus:…`)나 맨 값을 맨 값으로 돌려준다. */
export function stripBusPrefix(value: string): string {
	return stripPrefix(BUS_PREFIX, value);
}

/** 출처 구분 ID(`seoul-subway:…`)나 맨 값을 맨 값으로 돌려준다. */
export function stripSubwayPrefix(value: string): string {
	return stripPrefix(SUBWAY_PREFIX, value);
}

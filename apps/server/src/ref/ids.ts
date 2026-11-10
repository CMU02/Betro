/** 노선·정류장 ID 형식. 2-C `packages/commute/src/refs.ts`와 같다. */
export function busLine(busRouteId: string): string {
	return `seoul-bus:${busRouteId}`;
}

export function busStop(stId: string): string {
	return `seoul-bus:${stId}`;
}

export function subwayLine(lineKey: string): string {
	return `seoul-subway:${lineKey}`;
}

export function subwayStation(statnId: string): string {
	return `seoul-subway:${statnId}`;
}

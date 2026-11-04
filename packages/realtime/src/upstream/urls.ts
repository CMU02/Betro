export function subwayArrivalAllUrl(key: string): string {
	return `http://swopenAPI.seoul.go.kr/api/subway/${key}/json/realtimeStationArrival/ALL`;
}

export function subwayPositionUrl(key: string, lineNameKo: string): string {
	return `http://swopenAPI.seoul.go.kr/api/subway/${key}/json/realtimePosition/0/999/${encodeURIComponent(lineNameKo)}`;
}

export function busPositionUrl(key: string, busRouteId: string): string {
	return `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey=${encodeURIComponent(key)}&busRouteId=${busRouteId}&resultType=json`;
}

/** 원문과 `encodeURIComponent` 형태의 키를 `<key>`로 바꾼다. 빈 키는 무시. */
export function redactKeys(text: string, keys: readonly string[]): string {
	let out = text;
	for (const key of keys) {
		if (!key) {
			continue;
		}
		out = out.split(key).join("<key>");
		out = out.split(encodeURIComponent(key)).join("<key>");
	}
	return out;
}

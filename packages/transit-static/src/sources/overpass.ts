// Overpass API는 HTTPS를 지원한다. 선로 모양의 유일한 출처이며 키가 필요 없다.
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** 1호선 신창 36.77N, 경춘선 춘천 127.73E, 경강선 여주 127.63E를 포함하는 범위. */
export const SEOUL_METRO_BBOX = {
	east: 127.9,
	north: 38.0,
	south: 36.7,
	west: 126.3,
} as const;

export interface Bbox {
	east: number;
	north: number;
	south: number;
	west: number;
}

const ERROR_BODY_PREVIEW_LENGTH = 200;

/** bbox 안의 지하철/철도 route relation과 이를 묶는 route_master relation(멤버 포함)을 찾는다. */
export function discoverQuery(bbox: Bbox): string {
	const area = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
	return [
		"[out:json][timeout:120];",
		`relation["type"="route"]["route"~"^(subway|train|light_rail)$"](${area})->.routes;`,
		'rel(br.routes)["type"="route_master"]->.masters;',
		"(.routes;.masters;);",
		"out body;",
	].join("\n");
}

export function routeQuery(relationIds: number[]): string {
	return `[out:json][timeout:180];\nrelation(id:${relationIds.join(",")});\n(._;>;);\nout body;`;
}

export async function fetchOverpass(
	query: string,
	fetchImpl: typeof fetch = fetch
): Promise<unknown> {
	const response = await fetchImpl(OVERPASS_URL, {
		body: `data=${encodeURIComponent(query)}`,
		headers: { "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
	if (response.status !== 200) {
		const text = await response.text();
		throw new Error(
			`Overpass request failed: ${response.status} ${text.slice(0, ERROR_BODY_PREVIEW_LENGTH)}`
		);
	}
	return response.json();
}

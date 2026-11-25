/** 버스 구간의 출처. 서울 버스, 경기(GBIS), 인천(TAGO). */
export const BUS_SOURCE_IDS = ["seoul-bus", "gbis", "tago"] as const;
/** 지하철 구간의 출처. */
export const SUBWAY_SOURCE_IDS = ["seoul-subway"] as const;
export const SOURCE_IDS = [...BUS_SOURCE_IDS, ...SUBWAY_SOURCE_IDS] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export type LineRef = `${SourceId}:${string}`;
export type StopRef = `${SourceId}:${string}`;

function isSourceId(value: string): value is SourceId {
	return (SOURCE_IDS as readonly string[]).includes(value);
}

export function parseRef(ref: string): { source: SourceId; id: string } {
	const index = ref.indexOf(":");
	if (index <= 0) {
		throw new Error(`invalid ref (no source prefix): ${ref}`);
	}
	const source = ref.slice(0, index);
	const id = ref.slice(index + 1);
	if (!isSourceId(source)) {
		throw new Error(`unknown source in ref: ${source}`);
	}
	if (id === "") {
		throw new Error(`empty id in ref: ${ref}`);
	}
	return { id, source };
}

export function lineRef(source: SourceId, id: string): LineRef {
	return `${source}:${id}`;
}

export function stopRef(source: SourceId, id: string): StopRef {
	return `${source}:${id}`;
}

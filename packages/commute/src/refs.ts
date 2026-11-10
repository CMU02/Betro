export const SOURCE_IDS = ["seoul-bus", "seoul-subway"] as const;
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

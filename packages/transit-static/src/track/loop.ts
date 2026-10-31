import type { LngLat } from "./stitch";

export interface NodeLine {
	coords: LngLat[];
	nodeIds: number[];
}

const sameCoord = (a: LngLat | undefined, b: LngLat | undefined): boolean =>
	a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];

/** 첫 노드 id와 마지막 노드 id가 같거나, 첫 좌표와 마지막 좌표가 같으면 닫힌 선(고리)이다. */
export function isClosed(coords: LngLat[], nodeIds: number[]): boolean {
	if (coords.length < 2) {
		return false;
	}
	const [firstId] = nodeIds;
	const sameId = firstId !== undefined && firstId === nodeIds.at(-1);
	return sameId || sameCoord(coords[0], coords.at(-1));
}

/**
 * 닫힌 선을 nodeId의 첫 등장 위치에서 시작하도록 돌린다. 이음매 중복점을 빼고 돌린 뒤
 * 새 시작점을 끝에 다시 붙이므로 선은 닫힌 채이고 길이도 같다.
 * 열린 선이거나 nodeId가 선에 없으면 입력을 그대로 돌려준다.
 */
export function rotateToNode(
	coords: LngLat[],
	nodeIds: number[],
	nodeId: number
): NodeLine {
	const start = nodeIds.indexOf(nodeId);
	if (!isClosed(coords, nodeIds) || start <= 0) {
		return { coords, nodeIds };
	}
	const ringCoords = coords.slice(0, -1);
	const ringIds = nodeIds.slice(0, -1);
	const rotatedCoords = [
		...ringCoords.slice(start),
		...ringCoords.slice(0, start),
	];
	const rotatedIds = [...ringIds.slice(start), ...ringIds.slice(0, start)];
	const [headCoord] = rotatedCoords;
	const [headId] = rotatedIds;
	if (headCoord === undefined || headId === undefined) {
		return { coords, nodeIds };
	}
	return {
		coords: [...rotatedCoords, headCoord],
		nodeIds: [...rotatedIds, headId],
	};
}

import type { TrackDirection } from "@Betro/db/schema/transit";
import type { SubwayStatus } from "../observation";
import type { StationOnTrack, SubwayReference } from "../reference";
import type { ArrivalRow } from "../upstream/subway-arrival";

/** ALL 행 묶음에서 뽑은 열차 하나의 대표 상태. 위치를 못 정하면 statnId·status가 null. */
export interface TrainCandidate {
	btrainNo: string;
	/** 대표를 고르며 단 플래그(`flags` 맵의 같은 배열). */
	flags: string[];
	/** 대표 행. 위치를 못 정한 열차는 ordkey가 가장 작은 행. */
	row: ArrivalRow;
	statnId: string | null;
	status: SubwayStatus | null;
	subwayId: string;
}

/** 대표 후보끼리 이보다 많은 역만큼 떨어져 있으면 `conflicting-rows`. */
export const CONFLICT_STATION_GAP = 2;

const UP_LINES: ReadonlySet<string> = new Set(["상행", "내선", "0"]);
const DOWN_LINES: ReadonlySet<string> = new Set(["하행", "외선", "1"]);

/** ALL `updnLine`("상행"/"하행", 2호선 "내선"/"외선")과 위치 API("0"/"1")를 내부 방향으로. */
export function arrivalDirection(updnLine: string): TrackDirection | null {
	if (UP_LINES.has(updnLine)) {
		return "up";
	}
	return DOWN_LINES.has(updnLine) ? "down" : null;
}

/** `reduceArrivals`가 돌려주는 `flags` 맵의 키. */
export const trainGroupKey = (subwayId: string, btrainNo: string): string =>
	`${subwayId}|${btrainNo}`;

/** 한 역 안에서의 진행 순서: 전역출발 → 진입 → 도착 → 출발. */
const STATUS_RANK: Readonly<Record<SubwayStatus, number>> = {
	approach: 1,
	arrive: 2,
	depart: 3,
	"prev-depart": 0,
};

interface StationState {
	row: ArrivalRow;
	statnId: string;
	status: SubwayStatus;
}

/**
 * 행 하나를 역 기준 상태로(4단계 설계 4.5 규칙 2). 0·1·2·3은 그 역, 4·5는 이전 역(`statnFid`).
 * 99와 이전 역이 비어 있는 4·5는 null.
 */
function stationStateOf(row: ArrivalRow): StationState | null {
	switch (row.arvlCd) {
		case "0":
			return { row, statnId: row.statnId, status: "approach" };
		case "1":
			return { row, statnId: row.statnId, status: "arrive" };
		case "2":
			return { row, statnId: row.statnId, status: "depart" };
		case "3":
			return { row, statnId: row.statnId, status: "prev-depart" };
		case "4":
			return row.statnFid
				? { row, statnId: row.statnFid, status: "approach" }
				: null;
		case "5":
			return row.statnFid
				? { row, statnId: row.statnFid, status: "arrive" }
				: null;
		default:
			return null;
	}
}

const byOrdkey = <T extends { ordkey: string }>(a: T, b: T): number => {
	if (a.ordkey === b.ordkey) {
		return 0;
	}
	return a.ordkey < b.ordkey ? -1 : 1;
};

interface Placed {
	entry: StationOnTrack;
	/** 진행 방향 위치. 순환이 아니면 distanceM, 순환이면 첫 후보 기준으로 감은 seq 차이. */
	progress: number;
	/** 같은 모양에서의 역 순번(순환이면 감은 값). */
	seqOnShape: number;
	state: StationState;
}

/** 후보를 가장 많이 담는 같은 방향 모양(동률이면 본선, 그다음 작은 id). */
function bestShape(
	states: readonly StationState[],
	direction: TrackDirection,
	ref: SubwayReference
): { entries: { entry: StationOnTrack; state: StationState }[] } | null {
	const byShape = new Map<
		number,
		{ entry: StationOnTrack; state: StationState }[]
	>();
	for (const state of states) {
		for (const entry of ref.stationsByStatnId.get(state.statnId) ?? []) {
			if (entry.direction !== direction) {
				continue;
			}
			const list = byShape.get(entry.trackShapeId) ?? [];
			list.push({ entry, state });
			byShape.set(entry.trackShapeId, list);
		}
	}
	let best: { entry: StationOnTrack; state: StationState }[] | null = null;
	for (const [shapeId, entries] of byShape) {
		if (!best) {
			best = entries;
			continue;
		}
		const bestHead = best[0]?.entry;
		const isMain = entries[0]?.entry.branchKey === "main";
		const bestIsMain = bestHead?.branchKey === "main";
		const better =
			entries.length > best.length ||
			(entries.length === best.length &&
				(isMain === bestIsMain
					? shapeId < (bestHead?.trackShapeId ?? 0)
					: isMain));
		if (better) {
			best = entries;
		}
	}
	return best ? { entries: best } : null;
}

function place(
	entries: readonly { entry: StationOnTrack; state: StationState }[],
	ref: SubwayReference
): Placed[] {
	const head = entries[0]?.entry;
	const shape = head ? ref.shapes?.get(head.trackShapeId) : undefined;
	if (!(head && shape?.loop)) {
		return entries.map(({ entry, state }) => ({
			entry,
			progress: entry.distanceM,
			seqOnShape: entry.seq,
			state,
		}));
	}
	const n = shape.stationCount;
	return entries.map(({ entry, state }) => {
		let offset = (((entry.seq - head.seq) % n) + n) % n;
		if (offset > n / 2) {
			offset -= n;
		}
		return { entry, progress: offset, seqOnShape: offset, state };
	});
}

const isAhead = (a: Placed, b: Placed): boolean =>
	a.progress === b.progress
		? STATUS_RANK[a.state.status] > STATUS_RANK[b.state.status]
		: a.progress > b.progress;

/** 후보 여럿 중 진행 방향으로 가장 앞선 것(4.5 규칙 3). 거리를 못 구하면 ordkey가 가장 작은 행. */
function pickRepresentative(
	states: readonly StationState[],
	direction: TrackDirection | null,
	ref: SubwayReference,
	flags: string[]
): StationState {
	const shape = direction ? bestShape(states, direction, ref) : null;
	if (!shape) {
		const [first] = [...states].sort((a, b) => byOrdkey(a.row, b.row));
		return first as StationState;
	}
	const placed = place(shape.entries, ref);
	let best = placed[0] as Placed;
	let minSeq = best.seqOnShape;
	let maxSeq = best.seqOnShape;
	for (const candidate of placed) {
		if (isAhead(candidate, best)) {
			best = candidate;
		}
		minSeq = Math.min(minSeq, candidate.seqOnShape);
		maxSeq = Math.max(maxSeq, candidate.seqOnShape);
	}
	if (maxSeq - minSeq > CONFLICT_STATION_GAP) {
		flags.push("conflicting-rows");
	}
	return best.state;
}

function reduceGroup(
	rows: readonly ArrivalRow[],
	ref: SubwayReference
): TrainCandidate {
	const [first] = rows as [ArrivalRow];
	const flags: string[] = [];
	const states: StationState[] = [];
	for (const row of rows) {
		const state = stationStateOf(row);
		if (state) {
			states.push(state);
		} else if (
			(row.arvlCd === "4" || row.arvlCd === "5") &&
			!flags.includes("missing-prev-station")
		) {
			flags.push("missing-prev-station");
		}
	}
	const base = { btrainNo: first.btrainNo, flags, subwayId: first.subwayId };
	if (states.length === 0) {
		flags.push("position-unknown");
		const [row] = [...rows].sort(byOrdkey) as [ArrivalRow];
		return { ...base, row, statnId: null, status: null };
	}
	const direction = arrivalDirection(first.updnLine);
	const chosen =
		states.length === 1
			? (states[0] as StationState)
			: pickRepresentative(states, direction, ref, flags);
	return {
		...base,
		row: chosen.row,
		statnId: chosen.statnId,
		status: chosen.status,
	};
}

/**
 * ALL 행(역별 도착 목록)을 열차별 대표 (역, 상태) 하나로 줄인다(4단계 설계 4.5 규칙 1~4).
 * 열차는 처음 나온 순서대로 돌려준다. `flags`의 키는 `trainGroupKey(subwayId, btrainNo)`.
 */
export function reduceArrivals(
	rows: readonly ArrivalRow[],
	ref: SubwayReference
): { trains: TrainCandidate[]; flags: Map<string, string[]> } {
	const groups = new Map<string, ArrivalRow[]>();
	for (const row of rows) {
		const key = trainGroupKey(row.subwayId, row.btrainNo);
		const list = groups.get(key);
		if (list) {
			list.push(row);
		} else {
			groups.set(key, [row]);
		}
	}
	const trains: TrainCandidate[] = [];
	const flags = new Map<string, string[]>();
	for (const [key, group] of groups) {
		const train = reduceGroup(group, ref);
		trains.push(train);
		if (train.flags.length > 0) {
			flags.set(key, train.flags);
		}
	}
	return { flags, trains };
}

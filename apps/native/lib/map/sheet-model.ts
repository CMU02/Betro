import type { Leg } from "@Betro/commute/plan";

import { t } from "@/lib/i18n/t";
import type { MessageKey, MessageParams } from "@/lib/i18n/translate";
import { ESTIMATED_METHODS } from "@/lib/transit/eta-status";
import { isLoopBranch, subwayBranchForLeg } from "./leg-vehicles";
import type { BusMap, RouteViewLeg, SubwayMap } from "./map-client";
import { timetableIdOf } from "./scheduled-trains";

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60_000;
/** 서울 버스 관측 간격(최대 약 160초)보다 길게 잡아, 정상 갱신 사이에는 "실시간"으로 둔다. */
export const LIVE_MAX_AGE_SEC = 180;

export type SheetStopState = "past" | "now" | "next" | "mine";

export interface SheetModel {
	directionKey: MessageKey;
	directionParams: MessageParams;
	estimated: boolean;
	/** 위치의 신선도. 시간표 위치 열차는 관측이 아니어서 `scheduled`가 붙는다. */
	freshness: { live: boolean; scheduled?: true; secondsAgo: number };
	lineLabel: string;
	minutesToMine: number | null;
	stops: { name: string; state: SheetStopState }[];
	trainNo: string | null;
}

interface TrackStop {
	/** 버스 정류장의 진행 방면. 지하철 역과 모르는 정류장은 없다. */
	directionName?: string | null;
	name: string;
	seq: number;
	stop: string;
}

interface Track {
	/** 이 구간의 승차(하차) 정류장 위치. 순서 목록의 인덱스, 못 찾으면 -1. */
	alightIndex: number;
	boardIndex: number;
	loop: boolean;
	stops: TrackStop[];
}

function bySeq(a: TrackStop, b: TrackStop): number {
	return a.seq - b.seq;
}

/** 차량 위치(seq)가 가리키는 정류장의 인덱스. 정확히 없으면 그 앞쪽에서 가장 가까운 정류장, 그것도 없으면 0이다. */
function positionIndex(stops: readonly TrackStop[], positionSeq: number) {
	let found = 0;
	for (const [index, stop] of stops.entries()) {
		if (stop.seq <= positionSeq) {
			found = index;
		}
	}
	return found;
}

function busTrack(leg: Leg, map: BusMap): Track {
	const stops = [...map.stops].sort(bySeq);
	return {
		alightIndex:
			leg.mode === "bus"
				? stops.findIndex((stop) => stop.seq === leg.alight.seq)
				: -1,
		boardIndex:
			leg.mode === "bus"
				? stops.findIndex((stop) => stop.seq === leg.board.seq)
				: -1,
		loop: false,
		stops,
	};
}

function subwayTrack(leg: Leg, map: SubwayMap): Track | null {
	if (leg.mode !== "subway") {
		return null;
	}
	// 지도가 차량 순번을 잰 가지와 같은 가지를 써야 갈린 뒤 겹치는 순번을 맞게 읽는다.
	const branch = subwayBranchForLeg(leg, map);
	if (branch === null) {
		return null;
	}
	const stops = [...branch.stations].sort(bySeq);
	const lineKey = leg.line.slice(leg.line.indexOf(":") + 1);
	return {
		alightIndex: stops.findIndex((stop) => stop.stop === leg.alight.stop),
		boardIndex: stops.findIndex((stop) => stop.stop === leg.board.stop),
		loop: isLoopBranch(lineKey, branch.branchKey),
		stops,
	};
}

/**
 * 지난 정류장 1개, 현재, 다음 정류장들을 거쳐 내 정류장에서 끝나는 줄. 순환 가지는 이음매를 넘어 이어진다.
 * 내 정류장은 타기 전이면 승차 정류장, 탑승한 차량(`boarded`)이면 하차 정류장이다.
 */
function stopRows(
	track: Track,
	positionSeq: number,
	boarded: boolean
): { name: string; state: SheetStopState }[] {
	const { stops, loop } = track;
	const count = stops.length;
	if (count === 0) {
		return [];
	}
	const here = positionIndex(stops, positionSeq);
	const rows: { name: string; state: SheetStopState }[] = [];
	const past = loop ? (here - 1 + count) % count : here - 1;
	if (past >= 0 && past !== here) {
		rows.push({ name: stops[past]?.name ?? "", state: "past" });
	}
	rows.push({ name: stops[here]?.name ?? "", state: "now" });
	// 탑승한 차량이거나 직선 노선에서 이미 승차 정류장을 지났으면 하차 정류장에서 끝낸다.
	// 순환 가지는 위치만으로 지났는지 알 수 없어 탑승 여부(`boarded`)로만 정한다.
	const passedBoard = !loop && track.boardIndex <= here;
	const target = boarded || passedBoard ? track.alightIndex : track.boardIndex;
	if (target < 0 || (!loop && target <= here)) {
		return rows;
	}
	const steps = loop ? (target - here + count) % count : target - here;
	for (let step = 1; step <= steps; step += 1) {
		const stop = stops[(here + step) % count];
		rows.push({
			name: stop?.name ?? "",
			state: step === steps ? "mine" : "next",
		});
	}
	return rows;
}

function directionOf(
	leg: Leg,
	track: Track | null,
	positionSeq: number
): { key: MessageKey; params: MessageParams } {
	if (track === null || track.stops.length === 0) {
		return { key: "map.sheet.direction.bus", params: { name: "" } };
	}
	const { stops, loop } = track;
	if (leg.mode === "bus") {
		// 왕복 노선은 마지막 정류장이 출발지라, 차량이 있는 정류장의 방면을 먼저 쓴다.
		const here = stops[positionIndex(stops, positionSeq)];
		return {
			key: "map.sheet.direction.bus",
			params: { name: here?.directionName ?? stops.at(-1)?.name ?? "" },
		};
	}
	if (loop) {
		// 순환선에는 종점이 없어, 차량이 향하는 다음 역을 방면으로 쓴다.
		const next = (positionIndex(stops, positionSeq) + 1) % stops.length;
		return {
			key: "map.sheet.direction.subway",
			params: {
				loop: t(
					leg.direction === "up"
						? "map.sheet.loop.inner"
						: "map.sheet.loop.outer"
				),
				name: stops[next]?.name ?? "",
			},
		};
	}
	return {
		key: "map.sheet.direction.bus",
		params: { name: stops.at(-1)?.name ?? "" },
	};
}

/**
 * 지도에서 차량을 눌렀을 때 시트에 그릴 값(지도 설계 2.4).
 * 남은 분은 승차 정류장 도착판에 이 차량이 있을 때만 낸다(지도 설계 2.8).
 * 도착 계산이 시각을 못 내는 차량은 정류장 줄만 보여 준다.
 * 시간표 위치 열차(`scheduled:<tripId>`)는 열차 번호가 없고 추정이며, 도착판의 같은 trip(`timetable:<tripId>`) 시각을 쓴다.
 */
export function sheetModel(input: {
	/** 사용자가 이미 탄 차량이면 true. 줄이 하차 정류장에서 끝난다. */
	boarded: boolean;
	leg: Leg;
	map: BusMap | SubwayMap;
	nowMs: number;
	observedAt: number;
	positionSeq: number;
	vehicleId: string;
	view: RouteViewLeg | null;
}): SheetModel {
	const { boarded, leg, map, nowMs, observedAt, positionSeq, vehicleId, view } =
		input;
	const track = "stops" in map ? busTrack(leg, map) : subwayTrack(leg, map);
	const direction = directionOf(leg, track, positionSeq);
	const secondsAgo = Math.max(0, Math.floor((nowMs - observedAt) / MS_PER_SEC));
	const timetableId = timetableIdOf(vehicleId);
	const scheduled = timetableId !== null;
	const entry = view?.approaching.find(
		(item) => item.vehicleId === (timetableId ?? vehicleId)
	);
	const minutesToMine =
		entry?.etaAt === null || entry === undefined
			? null
			: Math.max(0, Math.floor((entry.etaAt - nowMs) / MS_PER_MIN));
	return {
		directionKey: direction.key,
		directionParams: direction.params,
		estimated: scheduled || ESTIMATED_METHODS.includes(entry?.method ?? ""),
		freshness: scheduled
			? { live: false, scheduled: true, secondsAgo }
			: { live: secondsAgo <= LIVE_MAX_AGE_SEC, secondsAgo },
		lineLabel: leg.lineName,
		minutesToMine,
		stops: track === null ? [] : stopRows(track, positionSeq, boarded),
		trainNo: leg.mode === "subway" && !scheduled ? vehicleId : null,
	};
}

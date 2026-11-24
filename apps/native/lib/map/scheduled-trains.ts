import type { SubwayLeg } from "@Betro/commute/plan";
import { z } from "zod";
import type { RefResult } from "@/lib/ref/ref-client";
import type { ServerClient } from "@/lib/server/api-client";

import { isLoopBranch, subwayBranchForLeg } from "./leg-vehicles";
import { read, type SubwayMap } from "./map-client";
import {
	createSubwayTrack,
	type MotionState,
	pointAlong,
	type SubwayTrack,
} from "./motion";
import type { RenderVehicle } from "./use-map-data";

const HALF_DIVISOR = 2;
const SUBWAY_PREFIX = "seoul-subway:";
/** 시간표 열차의 차량 ID 접두사. 도착판의 시간표 도착은 같은 trip을 `timetable:<tripId>`로 쓴다. */
export const SCHEDULED_ID_PREFIX = "scheduled:";
const TIMETABLE_ID_PREFIX = "timetable:";

const scheduledTrainSchema = z.object({
	direction: z.enum(["up", "down"]),
	fromStop: z.string(),
	progress: z.number(),
	toStop: z.string(),
	trainNo: z.string(),
	tripId: z.number(),
});

const scheduledTrainsSchema = z.object({
	generatedAt: z.number(),
	trains: z.array(scheduledTrainSchema),
});

/** 서버가 시간표로 낸 지금 달리는 열차. 역은 `seoul-subway:<statnId>`, `progress`는 앞 역(0)~다음 역(1)이다. */
export type ScheduledTrain = z.infer<typeof scheduledTrainSchema>;
export type ScheduledTrains = z.infer<typeof scheduledTrainsSchema>;

/** 시간표 열차인지. 실시간 열차 ID는 열차 번호다. */
export function isScheduledVehicleId(id: string): boolean {
	return id.startsWith(SCHEDULED_ID_PREFIX);
}

/** 시간표 열차와 같은 trip의 도착판 차량 ID(`timetable:<tripId>`). 시간표 열차가 아니면 null. */
export function timetableIdOf(id: string): string | null {
	return isScheduledVehicleId(id)
		? `${TIMETABLE_ID_PREFIX}${id.slice(SCHEDULED_ID_PREFIX.length)}`
		: null;
}

/** 시간표 추정 모드(14)의 시간표 위치 열차. 노선 ref(`seoul-subway:line2`)나 맨 노선 키를 받는다. */
export function fetchScheduledTrains(
	client: ServerClient,
	line: string
): Promise<RefResult<ScheduledTrains>> {
	const lineKey = line.startsWith(SUBWAY_PREFIX)
		? line.slice(SUBWAY_PREFIX.length)
		: line;
	return client
		.request("GET", `/v1/map/scheduled/${encodeURIComponent(lineKey)}`)
		.then((response) => read(response, scheduledTrainsSchema));
}

interface Placement {
	boardIndex: number;
	direction: SubwayLeg["direction"];
	loop: boolean;
	stations: SubwayTrack["stations"];
}

/** 열차가 승차역 앞(순환 가지는 승차역 뒤 반 바퀴 안)에 있는지. */
function isBeforeBoard(fromIndex: number, placement: Placement): boolean {
	const { boardIndex, loop, stations } = placement;
	const count = stations.length;
	if (!loop) {
		return fromIndex < boardIndex;
	}
	const behind = (boardIndex - fromIndex + count) % count;
	return behind > 0 && behind <= Math.floor(count / HALF_DIVISOR);
}

/**
 * 시간표 열차의 선로 위 거리. 구간 방향이 아니거나, 승차역 앞이 아니거나, 두 역이 이 가지에 없거나
 * 순서가 거꾸로면(다른 가지) null. 순환선 이음매(마지막 역 → 첫 역)는 앞 역 자리다.
 */
function trainDistanceM(
	train: ScheduledTrain,
	placement: Placement
): number | null {
	const { loop, stations } = placement;
	if (train.direction !== placement.direction) {
		return null;
	}
	const fromIndex = stations.findIndex((s) => s.stop === train.fromStop);
	const toIndex = stations.findIndex((s) => s.stop === train.toStop);
	const from = stations[fromIndex];
	const to = stations[toIndex];
	if (!(from && to && isBeforeBoard(fromIndex, placement))) {
		return null;
	}
	if (toIndex > fromIndex) {
		const progress = Math.min(1, Math.max(0, train.progress));
		return from.distanceM + (to.distanceM - from.distanceM) * progress;
	}
	return loop ? from.distanceM : null;
}

/** 그 지점에 멈춘 움직임 상태. 시간표 위치는 다음 응답까지 움직이지 않는다. */
function frozenAt(distanceM: number, at: number): MotionState {
	return {
		anchorAt: at,
		catchUpM: 0,
		ceilingM: distanceM,
		lastObservedAt: at,
		observedDistanceM: distanceM,
		shownDistanceM: distanceM,
		speedMps: 0,
	};
}

/**
 * 구간에서 보일 시간표 열차. `subwayVehiclesForLeg`와 같은 규칙(구간 방향, 승차역 앞, 순환선 반 바퀴)으로 거르고,
 * 가지는 `subwayBranchForLeg`로 고른다. 위치는 `createSubwayTrack(branch)`의 역 `distanceM` 두 개를 `progress`로
 * 보간한 거리를 `pointAlong(shape, distanceM)`에 넣어 낸다. 차량 ID는 `scheduled:<tripId>`, `estimated: true`.
 * 두 역이 이 가지에 없거나 순서가 거꾸로면(다른 가지) 그리지 않는다. 순환선 이음매(마지막 역 → 첫 역)는
 * 실시간 열차처럼 앞 역에 둔다. `generatedAt`은 응답 시각으로, 관측 시각 자리에 넣는다.
 */
export function scheduledVehicles(
	trains: readonly ScheduledTrain[],
	leg: SubwayLeg,
	map: SubwayMap,
	legIndex: number,
	generatedAt: number
): RenderVehicle[] {
	const branch = subwayBranchForLeg(leg, map);
	const track = branch === null ? null : createSubwayTrack(branch);
	if (branch === null || track === null) {
		return [];
	}
	const boardIndex = track.stations.findIndex(
		(station) => station.stop === leg.board.stop
	);
	if (boardIndex === -1) {
		return [];
	}
	const placement: Placement = {
		boardIndex,
		direction: leg.direction,
		loop: isLoopBranch(
			leg.line.slice(leg.line.indexOf(":") + 1),
			branch.branchKey
		),
		stations: track.stations,
	};
	const vehicles: RenderVehicle[] = [];
	for (const train of trains) {
		const distanceM = trainDistanceM(train, placement);
		const at = distanceM === null ? null : pointAlong(track.shape, distanceM);
		if (distanceM === null || at === null) {
			continue;
		}
		const fromStatnId = train.fromStop.slice(SUBWAY_PREFIX.length);
		vehicles.push({
			bearing: at.bearing,
			estimated: true,
			id: `${SCHEDULED_ID_PREFIX}${train.tripId}`,
			kind: "subway",
			lastSeenAt: generatedAt,
			latitude: at.latitude,
			legIndex,
			longitude: at.longitude,
			motion: frozenAt(distanceM, generatedAt),
			observedAt: generatedAt,
			observedPosition: at,
			positionSeq:
				branch.stations.find((station) => station.stop === train.fromStop)
					?.seq ?? null,
			statnId: fromStatnId,
			status: null,
		});
	}
	return vehicles;
}

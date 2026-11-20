import type { BusLeg, Leg, Route, SubwayLeg } from "@Betro/commute/plan";

import type {
	BusMap,
	BusSnapshotVehicle,
	SubwayMap,
	SubwaySnapshotVehicle,
} from "./map-client";

const HALF_DIVISOR = 2;

/** `seoul-bus:100100124` 같은 출처 구분 ID에서 맨 값만 꺼낸다. 접두어가 없으면 그대로 돌려준다. */
function bareId(ref: string): string {
	const index = ref.indexOf(":");
	return index === -1 ? ref : ref.slice(index + 1);
}

/** 같은 정류장이 두 번 나오면 순환 노선으로 본다. */
function isCircular(map: BusMap): boolean {
	const seen = new Set<string>();
	for (const { stop } of map.stops) {
		if (seen.has(stop)) {
			return true;
		}
		seen.add(stop);
	}
	return false;
}

/**
 * 이 구간에서 보일 버스. 같은 노선이면서 승차 순번보다 앞선 차량만 남긴다.
 * 순환 노선(`map`으로 판단)은 승차 순번 앞의 반 바퀴 안만 남긴다.
 * 탑승한 차량(`boardedId`)이 있으면 그 차량만, 하차 순번까지 남긴다.
 */
export function busVehiclesForLeg(
	leg: BusLeg,
	vehicles: readonly BusSnapshotVehicle[],
	boardedId: string | null,
	map: BusMap | null = null
): BusSnapshotVehicle[] {
	const routeId = bareId(leg.line);
	const onLine = vehicles.filter((vehicle) => vehicle.routeId === routeId);
	if (boardedId !== null) {
		return onLine.filter(
			(vehicle) =>
				vehicle.vehId === boardedId && vehicle.sectOrd <= leg.alight.seq
		);
	}
	const boardSeq = leg.board.seq;
	const lowerBound =
		map !== null && isCircular(map)
			? boardSeq - Math.floor(map.stops.length / HALF_DIVISOR)
			: Number.NEGATIVE_INFINITY;
	return onLine.filter(
		(vehicle) => vehicle.sectOrd < boardSeq && vehicle.sectOrd > lowerBound
	);
}

interface StationOrder {
	/** 순환 가지(2호선 본선)면 true. seq가 끝에서 처음으로 이어진다. */
	loop: boolean;
	order: Map<string, number>;
	stationCount: number;
}

/** 서버 `LOOP_BRANCHES`(line2|main)와 같다. 응답에 순환 표시가 없어 노선·가지로 정한다. */
const LOOP_LINE_KEY = "2";
const LOOP_BRANCH_KEY = "main";

/** 순환 가지(2호선 본선)인지. */
export function isLoopBranch(lineKey: string, branchKey: string): boolean {
	return lineKey === LOOP_LINE_KEY && branchKey === LOOP_BRANCH_KEY;
}

/** 구간 방향의 가지 중 승차역(가능하면 하차역도)을 지나는 것의 역 순서. 없으면 null. */
function stationOrder(leg: SubwayLeg, map: SubwayMap): StationOrder | null {
	const lineKey = bareId(leg.line);
	const candidates = map.branches
		.filter((branch) => branch.direction === leg.direction)
		.map((branch) => ({
			loop: isLoopBranch(lineKey, branch.branchKey),
			order: new Map(
				branch.stations.map((station) => [station.stop, station.seq])
			),
			stationCount: branch.stations.length,
		}))
		.filter((candidate) => candidate.order.has(leg.board.stop));
	return (
		candidates.find((candidate) => candidate.order.has(leg.alight.stop)) ??
		candidates[0] ??
		null
	);
}

/**
 * 이 구간에서 보일 열차. 같은 노선·같은 방향이면서 역 순서상 승차역 앞에 있는 열차만 남긴다.
 * 탑승한 열차가 있으면 그 열차만 남기고, 위치를 알면 하차역까지만 남긴다.
 */
export function subwayVehiclesForLeg(
	leg: SubwayLeg,
	vehicles: readonly SubwaySnapshotVehicle[],
	map: SubwayMap,
	boardedId: string | null
): SubwaySnapshotVehicle[] {
	const lineKey = bareId(leg.line);
	const sameLeg = vehicles.filter(
		(vehicle) =>
			vehicle.lineKey === lineKey && vehicle.direction === leg.direction
	);
	const found = stationOrder(leg, map);
	if (found === null) {
		return boardedId === null
			? []
			: sameLeg.filter((vehicle) => vehicle.rawTrainNo === boardedId);
	}
	const { loop, order, stationCount } = found;
	const seqOf = (vehicle: SubwaySnapshotVehicle): number | undefined =>
		vehicle.statnId === null
			? undefined
			: order.get(`seoul-subway:${vehicle.statnId}`);
	if (boardedId !== null) {
		const alightSeq = order.get(leg.alight.stop);
		return sameLeg.filter((vehicle) => {
			if (vehicle.rawTrainNo !== boardedId) {
				return false;
			}
			const seq = seqOf(vehicle);
			// 순환 가지는 하차역이 승차역보다 앞 순번일 수 있어 선형 비교를 하지 않는다.
			return (
				loop || seq === undefined || alightSeq === undefined || seq <= alightSeq
			);
		});
	}
	const boardSeq = order.get(leg.board.stop);
	return sameLeg.filter((vehicle) => {
		const seq = seqOf(vehicle);
		if (seq === undefined || boardSeq === undefined) {
			return false;
		}
		if (loop) {
			// 이음매를 넘어 승차역 뒤로 이어지는 반 바퀴 안의 열차만 남긴다.
			const behind = (boardSeq - seq + stationCount) % stationCount;
			return behind > 0 && behind <= Math.floor(stationCount / HALF_DIVISOR);
		}
		return seq < boardSeq;
	});
}

/** 숨긴 노선도 선은 그린다. 차량만 숨긴다(지도 설계 2.3). */
export function visibleLegs(
	route: Route,
	hiddenMapLines: readonly string[]
): { leg: Leg; showVehicles: boolean }[] {
	return route.legs.map((leg) => ({
		leg,
		showVehicles: !hiddenMapLines.includes(leg.line),
	}));
}

/** 경로의 모든 구간 노선이 숨김이면 true. 구간이 없으면 false. */
export function allLinesHidden(
	route: Route,
	hiddenMapLines: readonly string[]
): boolean {
	return (
		route.legs.length > 0 &&
		route.legs.every((leg) => hiddenMapLines.includes(leg.line))
	);
}

/**
 * 탑승이 판정된 차량 ID. 세션이 따르는 기본 경로(rank 0)의 지금 구간에서 승차 단계일 때만 그 차량 하나로 좁힌다.
 * 세션의 `legVehicleIds`는 탑승 전에도 예상이 고른 후보라, 그 밖에는 다가오는 차량을 모두 그린다(지도 설계 2.8).
 */
export function boardedVehicleId(args: {
	currentLegIndex: number;
	legIndex: number;
	rank: number;
	stage: string;
	vehicleId: string | null;
}): string | null {
	const { currentLegIndex, legIndex, rank, stage, vehicleId } = args;
	if (rank !== 0 || stage !== "ride" || legIndex !== currentLegIndex) {
		return null;
	}
	return vehicleId;
}

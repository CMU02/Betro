import { vehicleRouteKey } from "@/lib/map/leg-vehicles";
import type { BusMap, BusSnapshotVehicle } from "@/lib/map/map-client";
import {
	arrivalStatus,
	type EtaStatus,
	headwayStatus,
} from "@/lib/transit/eta-status";
import type { BusRouteViewResponse } from "./detail-client";

/** `vehicleHere`는 이 정류장을 지나 다음 정류장으로 가는 차량이 있다는 뜻이다(스냅샷 `sectOrd`). */
export interface BusTimelineStop {
	name: string;
	seq: number;
	state: "passed" | "current" | "upcoming";
	status: EtaStatus | null;
	vehicleHere: boolean;
}

export interface BusRouteModel {
	/** 지금 보이는 방향. 방향 이름이 없는 노선은 null이다. */
	direction: string | null;
	directions: string[];
	/** 고른 정류장 없이도 보이는 배차간격. 도착을 모르는(estimated) 노선 보기에만 있다. */
	headway: EtaStatus | null;
	selectedVehicle: {
		lowFloor: boolean;
		nextStopName: string | null;
		plate: string | null;
		status: EtaStatus | null;
	} | null;
	stops: BusTimelineStop[];
}

/** 서울 버스 위치 API의 busType. 1이 저상이다. */
const LOW_FLOOR_BUS_TYPE = "1";

interface DirectedStop {
	direction: string | null;
	name: string;
	seq: number;
}

/** 이름이 없는 정류장은 앞 정류장의 방면을 잇는다. 첫 정류장에 이름이 없으면 null이다. */
function withDirections(map: BusMap): DirectedStop[] {
	let current: string | null = null;
	return map.stops
		.slice()
		.sort((a, b) => a.seq - b.seq)
		.map((entry) => {
			current = entry.directionName ?? current;
			return { direction: current, name: entry.name, seq: entry.seq };
		});
}

function uniqueDirections(stops: readonly DirectedStop[]): string[] {
	const names: string[] = [];
	for (const entry of stops) {
		if (entry.direction !== null && !names.includes(entry.direction)) {
			names.push(entry.direction);
		}
	}
	return names;
}

/** 정류장에 가장 가까운 차량(서버가 가까운 순으로 준다)의 도착. 없으면 null. */
function stopArrival(
	view: BusRouteViewResponse,
	seq: number,
	now: number
): EtaStatus | null {
	const nearest = view.stops.find((entry) => entry.seq === seq)?.vehicles[0];
	if (nearest === undefined) {
		return null;
	}
	const status = arrivalStatus({
		etaAt: nearest.etaAt,
		etaState: view.etaState,
		method: null,
		now,
	});
	return status.text === "" ? null : status;
}

function selectedVehicleOf(
	input: { now: number; view: BusRouteViewResponse | null },
	ordered: readonly DirectedStop[],
	vehicle: BusSnapshotVehicle | undefined
): BusRouteModel["selectedVehicle"] {
	if (vehicle === undefined) {
		return null;
	}
	const next = ordered.find((entry) => entry.seq > vehicle.sectOrd);
	const arrival =
		input.view === null || next === undefined
			? undefined
			: input.view.stops
					.find((entry) => entry.seq === next.seq)
					?.vehicles.find((entry) => entry.vehicleId === vehicle.vehId);
	return {
		lowFloor: vehicle.busType === LOW_FLOOR_BUS_TYPE,
		nextStopName: next?.name ?? null,
		plate: vehicle.plainNo,
		status:
			arrival === undefined || input.view === null
				? null
				: arrivalStatus({
						etaAt: arrival.etaAt,
						etaState: input.view.etaState,
						method: null,
						now: input.now,
					}),
	};
}

/** 스냅샷은 모든 노선의 차량이 섞여 있어 이 노선 차량만 남긴다. */
export function lineVehicles(
	map: BusMap,
	vehicles: readonly BusSnapshotVehicle[]
): BusSnapshotVehicle[] {
	const routeKey = vehicleRouteKey(map.line);
	return vehicles.filter((entry) => entry.routeId === routeKey);
}

/**
 * 07 버스 노선 상세의 모델. 스냅샷 차량은 `vehicle.routeId === vehicleRouteKey(map.line)`인 것만 쓴다.
 * 노선 보기가 없거나 estimated면 도착은 모르므로, 고른 정류장 한 곳에만 배차간격을 둔다.
 */
export function busRouteModel(input: {
	map: BusMap;
	now: number;
	selectedDirection: string | null;
	selectedSeq: number | null;
	selectedVehicleId: string | null;
	vehicles: BusSnapshotVehicle[];
	view: BusRouteViewResponse | null;
}): BusRouteModel {
	const { map, now, selectedSeq, view } = input;
	const onLine = lineVehicles(map, input.vehicles);
	const ordered = withDirections(map);
	const directions = uniqueDirections(ordered);
	const selectedVehicle = onLine.find(
		(entry) => entry.vehId === input.selectedVehicleId
	);
	// 방향을 안 골랐으면 고른 정류장, 없으면 고른 차량이 있는 방향을 연다.
	const anchorSeq = selectedSeq ?? selectedVehicle?.sectOrd ?? null;
	const anchorDirection =
		anchorSeq === null
			? null
			: (ordered.find((entry) => entry.seq === anchorSeq)?.direction ?? null);
	let direction: string | null = directions[0] ?? null;
	if (
		input.selectedDirection !== null &&
		directions.includes(input.selectedDirection)
	) {
		direction = input.selectedDirection;
	} else if (anchorDirection !== null) {
		direction = anchorDirection;
	}
	const shown =
		direction === null
			? ordered
			: ordered.filter((entry) => entry.direction === direction);

	// 고른 정류장이 없으면 고른 차량의 위치를 기준으로 지난 정류장을 가른다.
	const currentSeq = selectedSeq ?? selectedVehicle?.sectOrd ?? null;
	const live = view !== null && view.etaState === "live";
	const hereSeqs = new Set(onLine.map((entry) => entry.sectOrd));

	const stops = shown.map<BusTimelineStop>((entry) => {
		let state: BusTimelineStop["state"] = "upcoming";
		if (currentSeq !== null && selectedSeq === entry.seq) {
			state = "current";
		} else if (currentSeq !== null && entry.seq < currentSeq) {
			state = "passed";
		}
		let status: EtaStatus | null = null;
		if (live) {
			status = stopArrival(view, entry.seq, now);
		} else if (view !== null && selectedSeq === entry.seq) {
			status = headwayStatus(view.headwayMs);
		}
		return {
			name: entry.name,
			seq: entry.seq,
			state,
			status,
			vehicleHere: hereSeqs.has(entry.seq),
		};
	});
	return {
		direction,
		directions,
		headway:
			view === null || view.etaState !== "estimated"
				? null
				: headwayStatus(view.headwayMs),
		selectedVehicle: selectedVehicleOf({ now, view }, ordered, selectedVehicle),
		stops,
	};
}

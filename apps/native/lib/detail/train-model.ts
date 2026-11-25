import { formatClock } from "@/lib/commute/lock-screen-model";
import { t } from "@/lib/i18n/t";
import { isLoopBranch } from "@/lib/map/leg-vehicles";
import type { SubwayMap, SubwaySnapshotVehicle } from "@/lib/map/map-client";
import { branchForTrain } from "@/lib/map/nearby-trains";
import { LIVE_MAX_AGE_SEC } from "@/lib/map/sheet-model";
import type { TripStops } from "./detail-client";

const MS_PER_SEC = 1000;
const SUBWAY_PREFIX = "seoul-subway:";

type Branch = SubwayMap["branches"][number];

export interface TrainModel {
	destinationName: string | null;
	directionLabel: string | null;
	express: boolean;
	freshness: { live: boolean; secondsAgo: number } | null;
	hasTimetable: boolean;
	nextStopName: string | null;
	stops: {
		name: string;
		state: "passed" | "current" | "upcoming";
		time: string | null;
	}[];
}

interface StopEntry {
	name: string;
	stop: string;
	time: string | null;
}

function bareId(ref: string): string {
	return ref.slice(ref.indexOf(":") + 1);
}

/** 차량이 없을 때(트립만 있을 때) 정차 역을 지나는 그 방향의 가지. */
function branchOfTrip(map: SubwayMap, trip: TripStops): Branch | null {
	return (
		map.branches.find(
			(branch) =>
				branch.direction === trip.direction &&
				trip.stops.some((entry) =>
					branch.stations.some((station) => station.stop === entry.stop)
				)
		) ?? null
	);
}

function tripEntries(trip: TripStops): StopEntry[] {
	return trip.stops.map((entry) => {
		const at = entry.arriveAt ?? entry.departAt;
		return {
			name: entry.name,
			stop: entry.stop,
			time:
				at === null
					? null
					: formatClock(Math.floor(at / MS_PER_SEC), trip.timezone),
		};
	});
}

function branchEntries(branch: Branch): StopEntry[] {
	return branch.stations
		.slice()
		.sort((a, b) => a.seq - b.seq)
		.map((station) => ({
			name: station.name,
			stop: station.stop,
			time: null,
		}));
}

function directionLabelOf(
	map: SubwayMap,
	branch: Branch | null,
	direction: "up" | "down" | null
): string | null {
	if (direction === null) {
		return null;
	}
	if (branch !== null && isLoopBranch(bareId(map.line), branch.branchKey)) {
		return t(
			direction === "up" ? "map.sheet.loop.inner" : "map.sheet.loop.outer"
		);
	}
	return t(
		direction === "up"
			? "trainDetail.direction.up"
			: "trainDetail.direction.down"
	);
}

function freshnessOf(
	vehicle: SubwaySnapshotVehicle | null,
	now: number
): TrainModel["freshness"] {
	if (vehicle === null) {
		return null;
	}
	const secondsAgo = Math.max(
		0,
		Math.floor((now - vehicle.observedAt) / MS_PER_SEC)
	);
	return { live: secondsAgo <= LIVE_MAX_AGE_SEC, secondsAgo };
}

/**
 * 06 열차 상세의 모델. 정차 목록은 시간표 열차(`trip`)가 있으면 그 정차들(시각 포함)이고,
 * 없으면 열차가 지나는 지선의 역(시각 없음)이다. 현재 역은 차량의 `statnId`다.
 * `stationsById`는 `statnId`(접두사 없는 값) → 역 이름이다.
 */
export function trainModel(input: {
	map: SubwayMap;
	now: number;
	stationsById: Record<string, string>;
	trip: TripStops | null;
	vehicle: SubwaySnapshotVehicle | null;
}): TrainModel {
	const { map, now, stationsById, trip, vehicle } = input;
	const direction = vehicle?.direction ?? trip?.direction ?? null;
	let branch: Branch | null = null;
	if (vehicle !== null) {
		branch = branchForTrain(map, vehicle);
	} else if (trip !== null) {
		branch = branchOfTrip(map, trip);
	}
	let entries: StopEntry[] = [];
	if (trip !== null) {
		entries = tripEntries(trip);
	} else if (branch !== null) {
		entries = branchEntries(branch);
	}

	const hereStop =
		vehicle === null || vehicle.statnId === null
			? null
			: `${SUBWAY_PREFIX}${vehicle.statnId}`;
	let hereIndex =
		hereStop === null
			? -1
			: entries.findIndex((entry) => entry.stop === hereStop);
	// 시간표가 없는 순환선은 가지 순번(1번 역부터)대로면 현재 역이 목록 끝에 묻힌다. 현재 역부터 한 바퀴로 돌린다.
	const isLoop =
		branch !== null && isLoopBranch(bareId(map.line), branch.branchKey);
	if (trip === null && isLoop && hereIndex > 0) {
		entries = [...entries.slice(hereIndex), ...entries.slice(0, hereIndex)];
		hereIndex = 0;
	}
	const stops = entries.map<TrainModel["stops"][number]>((entry, index) => {
		let state: TrainModel["stops"][number]["state"] = "upcoming";
		if (hereIndex >= 0 && index === hereIndex) {
			state = "current";
		} else if (hereIndex >= 0 && index < hereIndex) {
			state = "passed";
		}
		return { name: entry.name, state, time: entry.time };
	});

	const destinationId = vehicle?.destinationStatnId ?? null;
	return {
		destinationName:
			(destinationId === null ? undefined : stationsById[destinationId]) ??
			(trip === null ? null : (trip.stops.at(-1)?.name ?? null)),
		directionLabel: directionLabelOf(map, branch, direction),
		express: vehicle?.express ?? trip?.express ?? false,
		freshness: freshnessOf(vehicle, now),
		hasTimetable: trip !== null,
		nextStopName: hereIndex < 0 ? null : (entries[hereIndex + 1]?.name ?? null),
		stops,
	};
}

/** "{목적지}행 · {방향}". 목적지를 모르면 방향만, 둘 다 모르면 null이다. */
export function trainSubtitle(
	model: Pick<TrainModel, "destinationName" | "directionLabel">
): string | null {
	const { destinationName, directionLabel } = model;
	if (directionLabel === null) {
		return null;
	}
	if (destinationName === null) {
		return directionLabel;
	}
	return t("trainDetail.subtitle", {
		destination: destinationName,
		direction: directionLabel,
	});
}

/** 시간표 열차의 정차는 배치가 바뀌기 전까지 그대로라 자주 다시 받지 않는다. */
export const TRIP_STALE_MS = 5 * 60_000;

/**
 * 시간표 열차 쿼리의 `staleTime`. 조회 함수는 실패해도 throw하지 않으므로,
 * 성공이나 없음(not-found)만 신선하게 두고 오프라인·503·시간 초과는 바로 다시 받게 한다.
 */
export function tripStaleTime(query: {
	state: { data?: { ok: boolean; reason?: string } | undefined };
}): number {
	const { data } = query.state;
	if (data === undefined) {
		return 0;
	}
	return data.ok || data.reason === "not-found" ? TRIP_STALE_MS : 0;
}

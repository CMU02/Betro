import type { SubwayLeg } from "@Betro/commute/plan";

import { formatClock } from "@/lib/commute/lock-screen-model";
import { t } from "@/lib/i18n/t";
import { isLoopBranch, subwayBranchForLeg } from "@/lib/map/leg-vehicles";
import type { SubwayMap } from "@/lib/map/map-client";
import { arrivalStatus, type EtaStatus } from "@/lib/transit/eta-status";
import type { StationView, StationViewDirection } from "./detail-client";

const MS_PER_SEC = 1000;
/** 방향마다 보이는 도착 줄 수(Figma `16:9607`). */
const ROWS_PER_DIRECTION = 2;
/** 시간표 차량의 vehicleId 접두사. 실제 열차 번호가 아니라 열차 상세로 갈 수 없다. */
const TIMETABLE_PREFIX = "timetable:";

export interface StationDirectionRow {
	directionLabel: string;
	firstLabel: string | null;
	lastLabel: string | null;
	rows: { status: EtaStatus; trainNo: string | null }[];
}

export interface StationLineModel {
	directions: StationDirectionRow[];
	line: string;
}

type Branch = SubwayMap["branches"][number];

function bySeq(a: { seq: number }, b: { seq: number }): number {
	return a.seq - b.seq;
}

/** 이 역을 지나는 그 방향의 가지(`subwayBranchForLeg`와 같은 규칙). 지도가 없으면 null. */
function branchOf(
	map: SubwayMap | undefined,
	direction: "up" | "down",
	stop: string
): Branch | null {
	if (map === undefined) {
		return null;
	}
	const point = { name: "", stop } as SubwayLeg["board"];
	return subwayBranchForLeg({ alight: point, board: point, direction }, map);
}

/** 방면 글자. 순환선은 이 역 다음 역을, 그 밖에는 가지의 끝 역을 쓴다. */
function directionLabelOf(
	branch: Branch | null,
	line: string,
	direction: "up" | "down",
	stop: string
): string {
	if (branch === null) {
		return "";
	}
	const stations = branch.stations.slice().sort(bySeq);
	const lineKey = line.slice(line.indexOf(":") + 1);
	if (isLoopBranch(lineKey, branch.branchKey)) {
		const here = stations.findIndex((station) => station.stop === stop);
		// 순환선에는 종점이 없어 이 역 다음 역을 방면으로 쓴다(지도 시트와 같다).
		const next = stations[(here + 1) % stations.length];
		return t("map.sheet.direction.subway", {
			loop: t(
				direction === "up" ? "map.sheet.loop.inner" : "map.sheet.loop.outer"
			),
			name: next?.name ?? "",
		});
	}
	return t("stationDetail.direction", { name: stations.at(-1)?.name ?? "" });
}

function clockOf(epochMs: number | null, timezone: string): string | null {
	return epochMs === null
		? null
		: formatClock(Math.floor(epochMs / MS_PER_SEC), timezone);
}

function directionRow(
	entry: { line: string; stop: string },
	direction: StationViewDirection,
	map: SubwayMap | undefined,
	timezone: string,
	now: number
): StationDirectionRow {
	const branch = branchOf(map, direction.direction, entry.stop);
	return {
		directionLabel: directionLabelOf(
			branch,
			entry.line,
			direction.direction,
			entry.stop
		),
		firstLabel: clockOf(direction.firstAt, timezone),
		lastLabel: clockOf(direction.lastAt, timezone),
		// 도착 시각을 모르는 칸은 글자가 비어 그리지 않으므로 줄에서 뺀다.
		rows: direction.approaching
			.filter((arrival) => arrival.etaAt !== null)
			.slice(0, ROWS_PER_DIRECTION)
			.map((arrival) => ({
				status: arrivalStatus({
					etaAt: arrival.etaAt,
					etaState: direction.etaState,
					method: arrival.method,
					now,
				}),
				trainNo: arrival.vehicleId.startsWith(TIMETABLE_PREFIX)
					? null
					: arrival.vehicleId,
			})),
	};
}

/**
 * 역 상세에 그릴 값. 노선마다 방향별 도착 줄과 첫차·막차를 낸다.
 * `maps`의 키는 노선 ref(`seoul-subway:line2`)다. 지도를 못 받은 노선은 방면 글자만 비운다.
 */
export function stationModel(
	view: StationView,
	maps: Record<string, SubwayMap>,
	now: number
): StationLineModel[] {
	return view.stations.map((entry) => ({
		directions: entry.directions.map((direction) =>
			directionRow(entry, direction, maps[entry.line], view.timezone, now)
		),
		line: entry.line,
	}));
}

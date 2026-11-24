import type { CommuteConfig } from "@Betro/commute/config";
import { parseRef } from "@Betro/commute/refs";
import {
	fillFromTimetable,
	stationBoard,
	type TimetablePort,
	timetableOnlyBoard,
} from "@Betro/commute/sources/seoul-subway";
import type { ArrivalMethod, StopBoard } from "@Betro/commute/sources/types";

import type { CollectorRpcClient } from "../collector/client";
import type { StationRowsEntry } from "../collector/core-state";
import { WATCH_MS } from "../commute/runner-core";

/** 역 도착판이 쓰는 시간표. `D1Timetable`이 구현한다. */
export interface StationTimetable extends TimetablePort {
	firstLast: (
		line: string,
		direction: "up" | "down",
		statnId: string,
		atMs: number
	) => Promise<{ firstAt: number | null; lastAt: number | null }>;
}

export interface StationViewDirection {
	approaching: {
		etaAt: number | null;
		method: ArrivalMethod | null;
		stopsAway: number | null;
		vehicleId: string;
	}[];
	direction: "up" | "down";
	etaState: "live" | "estimated";
	firstAt: number | null;
	headwayMs: number | null;
	lastAt: number | null;
}

export interface StationView {
	generatedAt: number;
	stations: {
		directions: StationViewDirection[];
		line: string;
		stop: string;
	}[];
	timezone: string;
}

export interface StationViewDeps {
	collector: Pick<CollectorRpcClient, "stationRows" | "watchStations">;
	config: Pick<CommuteConfig, "staleAfterMs" | "subwayEtaBiasSec">;
	timetable: StationTimetable;
	timezone: string;
	/** isolate 메모리. 역 ID → 수집기에 등록해 둔 만료 시각. */
	watched: Map<string, number>;
}

/** 한 번에 물을 수 있는 역 수. */
export const STATION_VIEW_MAX = 6;
/** 방향마다 보여 주는 열차 수. */
export const STATION_VIEW_ARRIVALS = 3;

const DIRECTIONS = ["up", "down"] as const;
/**
 * 방향마다 읽는 시간표 도착 수. 예측이 없는 열차를 채우고도 3대가 남게 넉넉히 읽는다
 * (실행기의 `TIMETABLE_ARRIVALS`와 같다).
 */
const TIMETABLE_ARRIVALS = 6;
/** 등록 만료까지 이만큼보다 많이 남은 역은 다시 등록하지 않는다. */
const REWATCH_BEFORE_MS = WATCH_MS / 2;
const LIVE_METHODS: ReadonlySet<ArrivalMethod> = new Set([
	"official",
	"official-corrected",
]);

/**
 * 만료가 가까운 역만 수집기에 다시 등록한다. 수집기 DO는 등록마다 도착판 전체를 다시 저장하므로
 * 폴링마다 부르지 않는다. 등록에 성공한 역만 `watched`에 남긴다(실패하면 다음 요청이 다시 부른다).
 */
async function watchDue(
	deps: StationViewDeps,
	statnIds: readonly string[],
	now: number
): Promise<void> {
	const { collector, watched } = deps;
	for (const [statnId, until] of watched) {
		if (until <= now) {
			watched.delete(statnId);
		}
	}
	const due = statnIds.filter(
		(statnId) => (watched.get(statnId) ?? 0) - now <= REWATCH_BEFORE_MS
	);
	if (due.length === 0) {
		return;
	}
	const until = now + WATCH_MS;
	try {
		await collector.watchStations(due, until);
	} catch {
		return;
	}
	for (const statnId of due) {
		watched.set(statnId, until);
	}
}

/** 수집기의 최근 행. 실패하면 빈 값(시간표만으로 답한다). */
async function rowsOf(
	deps: StationViewDeps,
	statnIds: string[]
): Promise<Record<string, StationRowsEntry>> {
	try {
		return await deps.collector.stationRows(statnIds);
	} catch {
		return {};
	}
}

/**
 * 한 방향의 도착판. 수집기 행이 있으면 출퇴근 카드와 같은 `stationBoard` + `fillFromTimetable`,
 * 행이 없거나 그 방향 열차가 없으면 시간표만으로 만든다. `live`는 공식 예측이 묵지 않았을 때뿐이다.
 */
function boardOf(
	entry: StationRowsEntry | undefined,
	direction: "up" | "down",
	arrivals: { at: number; tripId: number }[],
	biasSec: number,
	now: number,
	staleAfterMs: number
): { board: StopBoard; live: boolean } {
	if (entry && entry.rows.length > 0) {
		const board = fillFromTimetable(
			stationBoard(null, entry.rows, direction, biasSec, entry.fetchedAt),
			arrivals
		);
		const [first] = board.approaching;
		if (first) {
			const fresh = now - board.sourceAt <= staleAfterMs;
			const official = first.method !== null && LIVE_METHODS.has(first.method);
			return { board, live: fresh && official };
		}
	}
	return { board: timetableOnlyBoard(arrivals, now), live: false };
}

async function directionOf(
	deps: StationViewDeps,
	ids: { line: string; statnId: string },
	entry: StationRowsEntry | undefined,
	direction: "up" | "down",
	now: number
): Promise<StationViewDirection> {
	const { config, timetable } = deps;
	const [arrivals, { firstAt, lastAt }] = await Promise.all([
		timetable.nextArrivals(
			ids.line,
			direction,
			ids.statnId,
			now,
			TIMETABLE_ARRIVALS
		),
		timetable.firstLast(ids.line, direction, ids.statnId, now),
	]);
	const { board, live } = boardOf(
		entry,
		direction,
		arrivals,
		config.subwayEtaBiasSec[ids.line] ?? 0,
		now,
		config.staleAfterMs
	);
	return {
		approaching: board.approaching
			.slice(0, STATION_VIEW_ARRIVALS)
			.map(({ etaAt, method, stopsAway, vehicleId }) => ({
				etaAt,
				method,
				stopsAway,
				vehicleId,
			})),
		direction,
		etaState: live ? "live" : "estimated",
		firstAt,
		headwayMs: board.headwayMs,
		lastAt,
	};
}

/**
 * 역 상세 도착판. 수집기가 이미 받는 `subway-all` 행과 D1 시간표로 만들고, 상류를 따로 부르지 않는다.
 * 수집기 호출이 실패하면 시간표만으로 답한다. `stations`의 ref는 라우트가 검증한 값이다.
 */
export async function stationView(
	deps: StationViewDeps,
	stations: readonly { line: string; stop: string }[],
	now: number
): Promise<StationView> {
	const statnIds = [
		...new Set(stations.map((station) => parseRef(station.stop).id)),
	];
	await watchDue(deps, statnIds, now);
	const rows = await rowsOf(deps, statnIds);
	const views = await Promise.all(
		stations.map(async ({ line, stop }) => {
			const ids = { line: parseRef(line).id, statnId: parseRef(stop).id };
			const entry = rows[ids.statnId];
			const directions = await Promise.all(
				DIRECTIONS.map((direction) =>
					directionOf(deps, ids, entry, direction, now)
				)
			);
			return { directions, line, stop };
		})
	);
	return { generatedAt: now, stations: views, timezone: deps.timezone };
}

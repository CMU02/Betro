import type { StationRow } from "@Betro/commute/sources/seoul-subway";
import { kstToEpochMs } from "@Betro/realtime/time";
import { beforeEach, describe, expect, it } from "bun:test";

import type { StationRowsEntry } from "../collector/core-state";
import {
	STATION_VIEW_ARRIVALS,
	type StationTimetable,
	stationView,
} from "./station-view";

const NOW = kstToEpochMs("2026-11-24 08:10:00");
const MINUTE_MS = 60_000;
const STALE_AFTER_MS = 150_000;
const STATN = "1002000222";
const FIRST_AT = kstToEpochMs("2026-11-24 05:30:00");
const LAST_AT = kstToEpochMs("2026-11-25 00:50:00");
const oneStation = [
	{ line: "seoul-subway:line2", stop: `seoul-subway:${STATN}` },
] as const;

/** 방향마다 4분 간격 시간표 도착. 위 방향은 1분 뒤, 아래 방향은 2분 뒤부터. */
const ARRIVALS: Record<"up" | "down", { at: number; tripId: number }[]> = {
	down: [2, 6, 10, 14].map((minute, index) => ({
		at: NOW + minute * MINUTE_MS,
		tripId: 200 + index,
	})),
	up: [1, 5, 9, 13].map((minute, index) => ({
		at: NOW + minute * MINUTE_MS,
		tripId: 100 + index,
	})),
};

let timetableCalls: [string, string, string, number][] = [];
const timetable: StationTimetable = {
	firstLast: () => Promise.resolve({ firstAt: FIRST_AT, lastAt: LAST_AT }),
	nextArrivals: (line, direction, statnId, fromMs) => {
		timetableCalls.push([line, direction, statnId, fromMs]);
		return Promise.resolve(statnId === STATN ? ARRIVALS[direction] : []);
	},
	rideMs: () => Promise.resolve(null),
};

const row = (over: Partial<StationRow>): StationRow => ({
	arvlCd: "99",
	barvlSec: 120,
	direction: "up",
	ordkey: "01002강남0",
	sourceAt: NOW - 10_000,
	trainNo: "2241",
	...over,
});

function fakeCollector(
	rows: Record<string, StationRowsEntry>,
	fail: { rows?: boolean; watch?: boolean } = {}
) {
	const watched: [string[], number][] = [];
	return {
		stationRows: (statnIds: string[]) => {
			if (fail.rows) {
				return Promise.reject(new Error("collector down"));
			}
			return Promise.resolve(
				Object.fromEntries(
					statnIds.flatMap((id) => {
						const entry = rows[id];
						return entry ? [[id, entry]] : [];
					})
				)
			);
		},
		watched,
		watchStations: (statnIds: string[], until: number) => {
			if (fail.watch) {
				return Promise.reject(new Error("collector down"));
			}
			watched.push([statnIds, until]);
			return Promise.resolve();
		},
	};
}

function depsOf(collector: ReturnType<typeof fakeCollector>) {
	return {
		collector,
		config: { staleAfterMs: STALE_AFTER_MS, subwayEtaBiasSec: {} },
		timetable,
		timezone: "test/zone",
		watched: new Map<string, number>(),
	};
}

const directionOf = (
	view: Awaited<ReturnType<typeof stationView>>,
	direction: "up" | "down"
) => view.stations[0]?.directions.find((d) => d.direction === direction);

beforeEach(() => {
	timetableCalls = [];
});

describe("stationView", () => {
	it("수집기 행이 있으면 출퇴근 카드와 같은 도착판이고 live다", async () => {
		const collector = fakeCollector({
			[STATN]: { fetchedAt: NOW - 5000, rows: [row({})] },
		});
		const view = await stationView(depsOf(collector), oneStation, NOW);
		const up = directionOf(view, "up");
		expect(up?.etaState).toBe("live");
		expect(up?.approaching[0]).toMatchObject({
			etaAt: NOW - 10_000 + 120_000,
			method: "official",
			stopsAway: 2,
			vehicleId: "2241",
		});
		expect(up).toMatchObject({
			firstAt: FIRST_AT,
			headwayMs: 4 * MINUTE_MS,
			lastAt: LAST_AT,
		});
		expect(collector.watched).toEqual([[[STATN], NOW + 300_000]]);
		expect(view).toMatchObject({ generatedAt: NOW, timezone: "test/zone" });
		expect(view.stations[0]).toMatchObject(oneStation[0]);
		// 시간표는 접두사 없는 노선 키와 역 ID로 묻는다.
		expect(timetableCalls).toContainEqual(["line2", "up", STATN, NOW]);
	});

	it("행이 있어도 그 방향 열차가 없으면 그 방향은 시간표 추정이다", async () => {
		const collector = fakeCollector({
			[STATN]: { fetchedAt: NOW - 5000, rows: [row({})] },
		});
		const view = await stationView(depsOf(collector), oneStation, NOW);
		const down = directionOf(view, "down");
		expect(down?.etaState).toBe("estimated");
		expect(down?.approaching.map((a) => a.vehicleId)).toEqual([
			"timetable:200",
			"timetable:201",
			"timetable:202",
		]);
	});

	it("행이 없으면 시간표 3대를 estimated로 낸다", async () => {
		const view = await stationView(depsOf(fakeCollector({})), oneStation, NOW);
		for (const direction of ["up", "down"] as const) {
			const board = directionOf(view, direction);
			expect(board?.etaState).toBe("estimated");
			expect(board?.approaching.map((a) => a.method)).toEqual([
				"timetable",
				"timetable",
				"timetable",
			]);
			expect(board?.approaching).toHaveLength(STATION_VIEW_ARRIVALS);
		}
		expect(directionOf(view, "down")?.approaching[0]).toEqual({
			etaAt: NOW + 2 * MINUTE_MS,
			method: "timetable",
			stopsAway: null,
			vehicleId: "timetable:200",
		});
	});

	it("묵은 행(staleAfterMs 초과)은 버리고 시간표 3대를 estimated로 낸다", async () => {
		const sourceAt = NOW - STALE_AFTER_MS - 1;
		const collector = fakeCollector({
			[STATN]: { fetchedAt: sourceAt, rows: [row({ sourceAt })] },
		});
		const view = await stationView(depsOf(collector), oneStation, NOW);
		const up = directionOf(view, "up");
		expect(up?.etaState).toBe("estimated");
		// 묵은 행의 열차(이미 지난 ETA, 낡은 정거장 수)는 내지 않는다.
		expect(up?.approaching).toEqual(
			[0, 1, 2].map((index) => ({
				etaAt: NOW + (1 + index * 4) * MINUTE_MS,
				method: "timetable",
				stopsAway: null,
				vehicleId: `timetable:${100 + index}`,
			}))
		);
	});

	it("첫 열차에 공식 예측이 없어 시간표로 채우면 estimated다", async () => {
		const collector = fakeCollector({
			[STATN]: { fetchedAt: NOW - 5000, rows: [row({ barvlSec: 0 })] },
		});
		const up = directionOf(
			await stationView(depsOf(collector), oneStation, NOW),
			"up"
		);
		expect(up?.etaState).toBe("estimated");
		expect(up?.approaching[0]).toMatchObject({
			method: "timetable",
			vehicleId: "2241",
		});
	});

	it("수집기가 throw해도 시간표로 답한다", async () => {
		const view = await stationView(
			depsOf(fakeCollector({}, { rows: true, watch: true })),
			oneStation,
			NOW
		);
		expect(directionOf(view, "up")?.approaching).toHaveLength(
			STATION_VIEW_ARRIVALS
		);
	});

	it("15초 뒤 같은 역을 다시 물으면 watchStations를 부르지 않고, 2분 30초가 지나면 다시 부른다", async () => {
		const collector = fakeCollector({});
		const deps = depsOf(collector);
		await stationView(deps, oneStation, NOW);
		await stationView(deps, oneStation, NOW + 15_000);
		expect(collector.watched).toHaveLength(1);
		await stationView(deps, oneStation, NOW + 150_000);
		expect(collector.watched).toEqual([
			[[STATN], NOW + 300_000],
			[[STATN], NOW + 450_000],
		]);
	});

	it("등록이 실패한 역은 다음 요청에서 다시 등록한다", async () => {
		const failing = depsOf(fakeCollector({}, { watch: true }));
		await stationView(failing, oneStation, NOW);
		expect(failing.watched.size).toBe(0);
		const collector = fakeCollector({});
		await stationView({ ...failing, collector }, oneStation, NOW + 15_000);
		expect(collector.watched).toEqual([[[STATN], NOW + 315_000]]);
	});

	it("이미 등록한 역만 빼고 새 역만 등록한다", async () => {
		const collector = fakeCollector({});
		const deps = depsOf(collector);
		await stationView(deps, oneStation, NOW);
		await stationView(
			deps,
			[
				...oneStation,
				{ line: "seoul-subway:shinbundang", stop: "seoul-subway:1077000687" },
			],
			NOW + 15_000
		);
		expect(collector.watched).toEqual([
			[[STATN], NOW + 300_000],
			[["1077000687"], NOW + 315_000],
		]);
	});
});

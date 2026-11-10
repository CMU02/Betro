import type { Approaching, ArrivalMethod, StopBoard } from "./types";

/**
 * `realtimeStationArrival/ALL`의 한 역 행을 줄인 것. 수집기가 세션이 보는 역의 행만 이 형태로 남긴다.
 * `direction`은 수집기의 방향 변환(`arrivalDirection`)을 거친 값이다.
 */
export interface StationRow {
	arvlCd: string;
	/** 공식 도착 예측(`barvlDt`, 초). 0이면 예측이 없다. */
	barvlSec: number;
	direction: "up" | "down";
	ordkey: string;
	/** 원천 시각(`recptnDt`). */
	sourceAt: number;
	trainNo: string;
}

/** 시간표 조회. 실행기가 D1 시간표로 구현한다. */
export interface TimetablePort {
	nextArrivals: (
		line: string,
		direction: "up" | "down",
		statnId: string,
		fromMs: number,
		limit: number
	) => Promise<{ at: number; tripId: number }[]>;
	rideMs: (
		line: string,
		direction: "up" | "down",
		fromStatnId: string,
		toStatnId: string,
		atMs: number
	) => Promise<number | null>;
}

const SECOND_MS = 1000;
/** `ordkey`의 3~5번째 글자가 "몇 정거장 전"이다(`01001성수0` → 1, `02006성수0` → 6). */
const STOPS_AWAY_FROM = 2;
const STOPS_AWAY_TO = 5;
/** 직전 폴링에서 이만큼 가까웠던 열차만 다음 폴링에서 사라졌을 때 지난 것으로 본다. */
const PASSABLE_STOPS_AWAY = 1;
/** 역에 진입·도착·출발했거나 전역에서 출발·진입·도착한 열차(`arvlCd` 0~5). 99는 운행 중. */
const NEAR_ARRIVAL_CODES: ReadonlySet<string> = new Set([
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
]);

function stopsAwayOf(ordkey: string): number | null {
	const digits = ordkey.slice(STOPS_AWAY_FROM, STOPS_AWAY_TO);
	if (digits.length !== STOPS_AWAY_TO - STOPS_AWAY_FROM) {
		return null;
	}
	const value = Number(digits);
	return Number.isInteger(value) ? value : null;
}

/**
 * 직전 폴링에서 역 바로 앞(한 정거장 이내)이었는가. 도착판은 가까운 두 대만 보여 주므로
 * 멀리 있던 열차가 목록에서 빠진 것은 역을 지났다는 뜻이 아니다.
 */
function wasNear(row: StationRow): boolean {
	if (NEAR_ARRIVAL_CODES.has(row.arvlCd)) {
		return true;
	}
	const stopsAway = stopsAwayOf(row.ordkey);
	return stopsAway !== null && stopsAway <= PASSABLE_STOPS_AWAY;
}

function approachingOf(row: StationRow, biasSec: number): Approaching {
	const hasEta = row.barvlSec > 0;
	const method: ArrivalMethod =
		biasSec === 0 ? "official" : "official-corrected";
	return {
		etaAt: hasEta ? row.sourceAt + (row.barvlSec + biasSec) * SECOND_MS : null,
		lastOfDay: false,
		method: hasEta ? method : null,
		plate: null,
		stopsAway: stopsAwayOf(row.ordkey),
		vehicleId: row.trainNo,
	};
}

const lastIfNull = (value: number | null): number =>
	value ?? Number.POSITIVE_INFINITY;

function compareNullsLast(a: number | null, b: number | null): number {
	const left = lastIfNull(a);
	const right = lastIfNull(b);
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

/** 정거장 수가 적은 순, 같으면 도착이 이른 순. 모르는 값은 뒤로. */
function nearestFirst(a: Approaching, b: Approaching): number {
	return (
		compareNullsLast(a.stopsAway, b.stopsAway) ||
		compareNullsLast(a.etaAt, b.etaAt)
	);
}

/**
 * 역 행 → 한 방향의 도착판. `biasSec`(노선별 편향)을 공식 예측에 더한다. 예측이 없는 열차(0)도
 * 위치(`stopsAway`)는 그대로 보여 준다. `prev`는 같은 역의 직전 폴링 행이다.
 * `passed`는 직전 폴링에서 한 정거장 이내였는데 지금 없는 열차다. 지금 행이 하나도 없으면
 * (빈 응답) 지난 것인지 알 수 없으므로 비운다.
 */
export function stationBoard(
	prev: StationRow[] | null,
	rows: StationRow[],
	direction: "up" | "down",
	biasSec: number,
	fetchedAt: number
): StopBoard {
	const own = rows.filter((row) => row.direction === direction);
	const sourceAt =
		rows.length === 0
			? fetchedAt
			: Math.max(...rows.map((row) => row.sourceAt));
	const seen = new Set<string>();
	const approaching = own
		.filter((row) => {
			const fresh = !seen.has(row.trainNo);
			seen.add(row.trainNo);
			return fresh;
		})
		.map((row) => approachingOf(row, biasSec))
		.sort(nearestFirst);
	const gone = new Set<string>();
	const canPass = rows.length > 0;
	for (const row of canPass ? (prev ?? []) : []) {
		if (row.direction === direction && !seen.has(row.trainNo) && wasNear(row)) {
			gone.add(row.trainNo);
		}
	}
	const hasPrev = prev !== null && prev.length > 0;
	return {
		...(hasPrev
			? { prevSourceAt: Math.max(...prev.map((row) => row.sourceAt)) }
			: {}),
		approaching,
		fetchedAt,
		headwayMs: null,
		passed: [...gone].map((vehicleId) => ({ at: sourceAt, vehicleId })),
		sourceAt,
	};
}

/**
 * 예측이 없는 열차에 `sourceAt` 뒤의 시간표 도착을 가까운 순서대로 하나씩 붙인다. 앞 열차의
 * 도착보다 이른 시간표 도착은 건너뛴다(순서가 뒤집히지 않게). 배차간격을 모르면 시간표의
 * 이웃한 두 도착의 차로 채운다.
 */
export function fillFromTimetable(
	board: StopBoard,
	arrivals: { at: number; tripId: number }[]
): StopBoard {
	if (arrivals.length === 0) {
		return board;
	}
	const future = arrivals
		.filter((arrival) => arrival.at > board.sourceAt)
		.sort((a, b) => a.at - b.at);
	let floor = board.sourceAt;
	let index = 0;
	const approaching = board.approaching.map((train): Approaching => {
		if (train.etaAt !== null) {
			floor = Math.max(floor, train.etaAt);
			return train;
		}
		while (index < future.length && (future[index]?.at ?? 0) <= floor) {
			index += 1;
		}
		const next = future[index];
		if (!next) {
			return train;
		}
		index += 1;
		floor = next.at;
		return { ...train, etaAt: next.at, method: "timetable" };
	});
	const [first, second] = future;
	const headwayMs =
		board.headwayMs ?? (first && second ? second.at - first.at : null);
	return { ...board, approaching, headwayMs };
}

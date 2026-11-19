/**
 * 여유 폭 사전 수집(`leave-margin.ts`)의 수집 기록 → 표본 변환. 파일을 읽지 않는 순수한 부분만
 * 두어 고정 데이터로 시험한다.
 */
import type { MarginSample } from "../packages/commute/src/margin";
import type { LineRef } from "../packages/commute/src/refs";
import {
	busBoards,
	parseRouteArrivals,
	type RouteStopArrival,
} from "../packages/commute/src/sources/seoul-bus";
import {
	type StationRow,
	stationBoard,
} from "../packages/commute/src/sources/seoul-subway";
import type { StopBoard } from "../packages/commute/src/sources/types";
import type { SubwayObservation } from "../packages/realtime/src/observation";
import { arrivalDirection } from "../packages/realtime/src/subway/reduce-arrivals";
import { kstToEpochMs } from "../packages/realtime/src/time";
import {
	type ArrivalRow,
	parseStationArrivalAll,
} from "../packages/realtime/src/upstream/subway-arrival";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 같은 차량이 이 간격 안에 다시 도착으로 잡히면 같은 도착이다(순환선·회차는 이보다 길다). */
const SAME_VISIT_MS = 30 * MINUTE_MS;
/** 실제 도착 구간이 이보다 넓으면 기록이 빈 것이라 뺀다. */
const MAX_ARRIVAL_SPAN_MS = 10 * MINUTE_MS;
/** 도착보다 이만큼 앞선 예측까지만 그 도착의 표본에 붙인다(예측 창보다 넉넉히). */
const PREDICTION_LOOKBACK_MS = 30 * MINUTE_MS;

export interface SubwayTarget {
	direction: "up" | "down";
	line: LineRef;
	mode: "subway";
	statnId: string;
}

export interface BusTarget {
	line: LineRef;
	mode: "bus";
	routeId: string;
	seq: number | null;
	stId: string;
}

export type Target = SubwayTarget | BusTarget;

type Prediction = MarginSample["predictions"][number];

// ── 공통 ────────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key) ?? [];
	list.push(value);
	map.set(key, list);
}

/** 도착으로 잡힌 기록 → 도착 묶음마다 첫 기록. `SAME_VISIT_MS`보다 벌어지면 다른 도착이다. */
export function firstOfVisits<T extends { sourceAt: number }>(
	records: T[]
): T[] {
	const sorted = [...records].sort((a, b) => a.sourceAt - b.sourceAt);
	const firsts: T[] = [];
	let last: number | null = null;
	for (const record of sorted) {
		if (last === null || record.sourceAt - last > SAME_VISIT_MS) {
			firsts.push(record);
		}
		last = record.sourceAt;
	}
	return firsts;
}

/** 받은 시각 오름차순 `records`에서 `fetchedAt`이 `value`보다 이른 마지막 것. */
export function latestBefore<T extends { fetchedAt: number }>(
	records: T[],
	value: number
): T | null {
	let found: T | null = null;
	for (const record of records) {
		if (record.fetchedAt >= value) {
			break;
		}
		found = record;
	}
	return found;
}

export function sampleOf(
	target: Target,
	low: number,
	high: number,
	predictions: Prediction[]
): MarginSample | null {
	if (!(low < high && high - low <= MAX_ARRIVAL_SPAN_MS)) {
		return null;
	}
	return {
		high,
		line: target.line,
		low,
		mode: target.mode,
		predictions: predictions.filter(
			(prediction) =>
				prediction.at < high && prediction.at >= low - PREDICTION_LOOKBACK_MS
		),
	};
}

const liveOf = (method: string | null): boolean =>
	method !== null && method !== "timetable";

/** 도착판의 다가오는 차량 → 차량별 예측. */
function collectPredictions(
	board: StopBoard,
	at: number,
	into: Map<string, Prediction[]>
): void {
	for (const train of board.approaching) {
		if (train.etaAt !== null) {
			pushTo(into, train.vehicleId, {
				at,
				etaAt: train.etaAt,
				live: liveOf(train.method),
			});
		}
	}
}

// ── 지하철 ──────────────────────────────────────────────────────────

/** 수집기 `stationRowOf`와 같은 변환(ALL 행 → 역 도착판 행). 역 ID를 함께 남긴다. */
function stationRowOf(
	row: ArrivalRow
): { row: StationRow; statnId: string } | null {
	const direction = arrivalDirection(row.updnLine);
	if (direction === null) {
		return null;
	}
	let sourceAt: number;
	try {
		sourceAt = kstToEpochMs(row.recptnDt);
	} catch {
		return null;
	}
	const barvlSec = Number(row.barvlDt ?? "0");
	return {
		row: {
			arvlCd: row.arvlCd,
			barvlSec: Number.isFinite(barvlSec) && barvlSec > 0 ? barvlSec : 0,
			direction,
			ordkey: row.ordkey,
			sourceAt,
			trainNo: row.btrainNo,
		},
		statnId: row.statnId,
	};
}

export interface SubwaySnapshot {
	fetchedAt: number;
	/** 대상 역 → 그 역의 행. */
	rows: Map<string, StationRow[]>;
}

/**
 * 원본 한 줄 → 대상 역 행. 직전과 본문이 같아 해시만 남은 줄(`body` 없음)과 실패 응답은 뺀다.
 */
export function subwaySnapshotOf(
	line: unknown,
	statnIds: ReadonlySet<string>
): SubwaySnapshot | null {
	if (!isRecord(line)) {
		return null;
	}
	const { body, fetchedAt } = line;
	if (typeof body !== "string" || typeof fetchedAt !== "number") {
		return null;
	}
	const parsed = parseStationArrivalAll(parseJson(body));
	if (!parsed.ok) {
		return null;
	}
	const rows = new Map<string, StationRow[]>();
	for (const arrival of parsed.rows) {
		if (!statnIds.has(arrival.statnId)) {
			continue;
		}
		const station = stationRowOf(arrival);
		if (station) {
			pushTo(rows, station.statnId, station.row);
		}
	}
	return { fetchedAt, rows };
}

export function isSubwayArrive(value: unknown): value is SubwayObservation {
	return (
		isRecord(value) &&
		value.status === "arrive" &&
		typeof value.rawTrainNo === "string" &&
		typeof value.statnId === "string" &&
		typeof value.sourceAt === "number" &&
		typeof value.observedAt === "number"
	);
}

/**
 * 지하철 대상 하나의 표본. 예측은 스냅샷마다 `stationBoard`(노선 보정 포함)로 만든다.
 * 실제 도착은 이벤트에서 그 열차가 대상 역에 `arrive`로 처음 잡힌 원천 시각을 `high`로,
 * 그 이벤트를 낸 스냅샷 바로 앞 스냅샷의 원천 시각(그 역 행의 가장 늦은 `recptnDt`)을 `low`로
 * 둔다(실험 6). 이벤트의 `observedAt`은 원본 줄의 `fetchedAt`과 같은 값이라 스냅샷을 맞출 수 있다.
 * 이벤트를 낸 스냅샷 안에서는 행마다 `recptnDt`가 달라 그 역 시각이 `high`보다 이를 수 있으므로
 * 그 스냅샷의 시각은 `low`로 쓰지 않는다.
 */
export function subwaySamplesFor(
	target: SubwayTarget,
	snapshots: SubwaySnapshot[],
	arrivals: SubwayObservation[],
	biasSec: number
): MarginSample[] {
	const predictions = new Map<string, Prediction[]>();
	/** 받은 시각 순서의 스냅샷마다 그 역 도착판의 원천 시각. */
	const boardTimes: { fetchedAt: number; sourceAt: number }[] = [];
	let prev: StationRow[] | null = null;
	for (const snapshot of snapshots) {
		const rows = snapshot.rows.get(target.statnId) ?? [];
		if (rows.length === 0) {
			continue;
		}
		const board = stationBoard(
			prev,
			rows,
			target.direction,
			biasSec,
			snapshot.fetchedAt
		);
		boardTimes.push({
			fetchedAt: snapshot.fetchedAt,
			sourceAt: board.sourceAt,
		});
		collectPredictions(board, snapshot.fetchedAt, predictions);
		prev = rows;
	}

	const arriveTimes = new Map<
		string,
		{ observedAt: number; sourceAt: number }[]
	>();
	for (const arrival of arrivals) {
		if (
			arrival.statnId === target.statnId &&
			arrival.direction === target.direction &&
			arrival.sourceAt !== null
		) {
			pushTo(arriveTimes, arrival.rawTrainNo, {
				observedAt: arrival.observedAt,
				sourceAt: arrival.sourceAt,
			});
		}
	}
	const samples: MarginSample[] = [];
	for (const [trainNo, times] of arriveTimes) {
		for (const first of firstOfVisits(times)) {
			const low = latestBefore(boardTimes, first.observedAt)?.sourceAt ?? null;
			const sample =
				low === null
					? null
					: sampleOf(
							target,
							low,
							first.sourceAt,
							predictions.get(trainNo) ?? []
						);
			if (sample) {
				samples.push(sample);
			}
		}
	}
	return samples;
}

// ── 버스 ────────────────────────────────────────────────────────────

/** 한 응답 안 한 노선의 정류장들. */
interface BusRouteObservation {
	/** 차량 칸이 하나라도 읽히지 않은 정류장의 순번. 그 정류장에서는 차량이 빠져 있을 수 있다. */
	incompleteSeqs: Set<number>;
	stops: RouteStopArrival[];
}

export interface BusResponse {
	fetchedAt: number;
	/** 노선 ID → 그 노선의 정류장들. 한 `/dump`에 여러 노선이 섞일 수 있다. */
	routes: Map<string, BusRouteObservation>;
}

/**
 * 버스 `/dump` 줄을 뺀 이유. `malformed`: 줄·본문을 알아볼 수 없음, `failed`: 실패 응답,
 * `empty`: 정류장이 하나도 없는 응답, `noRoute`: 줄에도 응답 칸에도 노선이 없음.
 */
export type BusDropReason = "empty" | "failed" | "malformed" | "noRoute";

/**
 * 버스 대상 하나가 응답을 관측으로 쓰지 않은 이유. `otherRoute`: 그 노선 칸이 없음,
 * `stopMissing`: 대상 정류장 칸이 없거나 읽히지 않음, `vehicleUnparsed`: 대상 정류장의 차량 칸이
 * 하나라도 읽히지 않음.
 */
export type BusSkipReason = "otherRoute" | "stopMissing" | "vehicleUnparsed";

export type BusDropCounts = Partial<Record<BusDropReason, number>>;
export type BusSkipCounts = Partial<Record<BusSkipReason, number>>;

/** 차량이 없는 칸의 `vehId`(`seoul-bus.ts`와 같은 값). */
const EMPTY_VEHICLE_ID = "0";
const VEHICLE_SLOTS = [1, 2] as const;

function countInto<K extends string>(
	counts: Partial<Record<K, number>>,
	key: K
): void {
	counts[key] = (counts[key] ?? 0) + 1;
}

const textOf = (value: unknown): string | null =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function timeOf(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/** 성공 응답 본문의 정류장 칸(가공 전). */
function rawItemsOf(body: unknown): unknown[] {
	const msgBody = isRecord(body) ? body.msgBody : null;
	const items = isRecord(msgBody) ? msgBody.itemList : null;
	return Array.isArray(items) ? items : [];
}

/**
 * 정류장 칸 하나 → 정류장. `parseRouteArrivals`에 칸 하나짜리 성공 봉투를 넘겨 같은 규칙으로
 * 읽는다. 읽지 못하면 null.
 */
function stopOfItem(item: unknown): RouteStopArrival | null {
	const parsed = parseRouteArrivals({
		msgBody: { itemList: [item] },
		msgHeader: { headerCd: "0" },
	});
	return parsed.ok ? (parsed.stops[0] ?? null) : null;
}

/** 칸에 적힌 차량 수(`vehId`가 비지 않고 "0"이 아닌 칸). 읽힌 차량이 이보다 적으면 빠진 것이 있다. */
function listedVehiclesOf(item: unknown): number {
	if (!isRecord(item)) {
		return 0;
	}
	return VEHICLE_SLOTS.filter((n) => {
		const vehicleId = textOf(item[`vehId${n}`]);
		return vehicleId !== null && vehicleId !== EMPTY_VEHICLE_ID;
	}).length;
}

/**
 * 정류장 칸들 → 노선별 정류장. 칸의 `busRouteId`를 먼저 보고 없으면 줄의 노선을 쓴다. 노선을
 * 알 수 없는 칸이 하나라도 있으면 null(다른 노선 칸이 섞였을 수 있어 줄 전체를 믿지 않는다).
 */
function routesOf(
	items: unknown[],
	lineRouteId: string | null
): Map<string, BusRouteObservation> | null {
	const routes = new Map<string, BusRouteObservation>();
	for (const item of items) {
		const routeId =
			(isRecord(item) ? textOf(item.busRouteId) : null) ?? lineRouteId;
		if (routeId === null) {
			return null;
		}
		const stop = stopOfItem(item);
		if (stop === null) {
			continue;
		}
		const route = routes.get(routeId) ?? {
			incompleteSeqs: new Set<number>(),
			stops: [],
		};
		route.stops.push(stop);
		if (stop.vehicles.length < listedVehiclesOf(item)) {
			route.incompleteSeqs.add(stop.seq);
		}
		routes.set(routeId, route);
	}
	for (const route of routes.values()) {
		route.stops.sort((a, b) => a.seq - b.seq);
	}
	return routes;
}

/**
 * `/dump` 한 줄 → 노선 도착 응답. 실험 6 Worker의 줄 모양을 이 저장소에서 확인하지 못해
 * 여러 이름을 받는다(`fetchedAt`|`at`, `routeId`|`busRouteId`, `body`|`response`, 본문은
 * 문자열 JSON 또는 객체). 실패·빈 응답은 차량이 사라진 것으로 보지 않도록 뺀다.
 */
function busResponseOf(
	line: unknown
): { response: BusResponse } | { dropped: BusDropReason } {
	if (!isRecord(line)) {
		return { dropped: "malformed" };
	}
	const fetchedAt = timeOf(line.fetchedAt ?? line.at);
	const rawBody = line.body ?? line.response;
	const body = typeof rawBody === "string" ? parseJson(rawBody) : rawBody;
	if (fetchedAt === null) {
		return { dropped: "malformed" };
	}
	const parsed = parseRouteArrivals(body);
	if (!parsed.ok) {
		return { dropped: parsed.headerCd === null ? "malformed" : "failed" };
	}
	if (parsed.stops.length === 0) {
		return { dropped: "empty" };
	}
	const routes = routesOf(
		rawItemsOf(body),
		textOf(line.routeId) ?? textOf(line.busRouteId)
	);
	return routes === null
		? { dropped: "noRoute" }
		: { response: { fetchedAt, routes } };
}

/** `/dump` 줄들 → 받은 시각 순서의 응답과 뺀 줄의 이유별 개수. */
export function busResponsesOf(lines: Iterable<unknown>): {
	dropped: BusDropCounts;
	responses: BusResponse[];
} {
	const responses: BusResponse[] = [];
	const dropped: BusDropCounts = {};
	for (const line of lines) {
		const result = busResponseOf(line);
		if ("dropped" in result) {
			countInto(dropped, result.dropped);
		} else {
			responses.push(result.response);
		}
	}
	return {
		dropped,
		responses: responses.sort((a, b) => a.fetchedAt - b.fetchedAt),
	};
}

/** 응답에서 대상 정류장을 온전히 읽었으면 그 노선의 정류장들과 대상 순번, 아니면 쓰지 않은 이유. */
function targetStopOf(
	target: BusTarget,
	response: BusResponse
): { seq: number; stops: RouteStopArrival[] } | { skipped: BusSkipReason } {
	const route = response.routes.get(target.routeId);
	if (route === undefined) {
		return { skipped: "otherRoute" };
	}
	const stop = route.stops.find((candidate) =>
		target.seq === null
			? candidate.stopId === target.stId
			: candidate.seq === target.seq
	);
	if (stop === undefined) {
		return { skipped: "stopMissing" };
	}
	if (route.incompleteSeqs.has(stop.seq)) {
		return { skipped: "vehicleUnparsed" };
	}
	return { seq: stop.seq, stops: route.stops };
}

/**
 * 버스 대상 하나의 표본. 예측은 응답마다 `busBoards`의 대상 정류장 도착판이다.
 * 실제 도착은 차량이 대상 정류장 예측 목록에서 사라졌거나, 지났거나(`passed`), 정류장에
 * 있는(`stopsAway` 0) 첫 응답의 원천 시각을 `high`로, 직전 응답의 원천 시각을 `low`로 둔다.
 * "사라짐"은 대상 정류장을 온전히 읽은 두 응답 사이에서만 본다. 실패·빈 응답은 읽을 때 뺐고,
 * 대상 노선 칸이 없거나, 대상 정류장 칸이 없거나 읽히지 않았거나, 그 정류장의 차량 칸이 하나라도
 * 읽히지 않은 응답은 관측이 없던 것으로 건너뛴다(`prev`·직전 목록도 그대로 둔다). 그런 응답을
 * 쓰면 목록에서 빠진 차량이 거짓 도착으로 잡히고, `SAME_VISIT_MS` 중복 제거가 실제 도착을 가린다.
 */
export function busSamplesFor(
	target: BusTarget,
	responses: BusResponse[]
): { samples: MarginSample[]; skipped: BusSkipCounts } {
	const predictions = new Map<string, Prediction[]>();
	const lastArrivedAt = new Map<string, number>();
	const arrivals: { high: number; low: number; vehicleId: string }[] = [];
	const skipped: BusSkipCounts = {};
	let prev: RouteStopArrival[] | null = null;
	/** 직전 관측에서 대상 정류장 목록에 있던 차량. */
	let prevListed = new Set<string>();
	for (const response of responses) {
		const found = targetStopOf(target, response);
		if ("skipped" in found) {
			countInto(skipped, found.skipped);
			continue;
		}
		const { seq, stops } = found;
		const board = busBoards(prev, stops, response.fetchedAt).board(seq);
		collectPredictions(board, response.fetchedAt, predictions);
		const listed = new Set(
			board.approaching.map((vehicle) => vehicle.vehicleId)
		);
		const arrived = [
			...[...prevListed].filter((vehicleId) => !listed.has(vehicleId)),
			...board.passed.map((vehicle) => vehicle.vehicleId),
			...board.approaching
				.filter((vehicle) => vehicle.stopsAway === 0)
				.map((vehicle) => vehicle.vehicleId),
		];
		for (const vehicleId of new Set(arrived)) {
			const last = lastArrivedAt.get(vehicleId);
			const isNewVisit =
				last === undefined || board.sourceAt - last > SAME_VISIT_MS;
			if (isNewVisit && board.prevSourceAt !== undefined) {
				arrivals.push({
					high: board.sourceAt,
					low: board.prevSourceAt,
					vehicleId,
				});
			}
			lastArrivedAt.set(vehicleId, board.sourceAt);
		}
		prev = stops;
		prevListed = listed;
	}
	const samples: MarginSample[] = [];
	for (const arrival of arrivals) {
		const sample = sampleOf(
			target,
			arrival.low,
			arrival.high,
			predictions.get(arrival.vehicleId) ?? []
		);
		if (sample) {
			samples.push(sample);
		}
	}
	return { samples, skipped };
}

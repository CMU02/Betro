import { describe, expect, test } from "bun:test";
import type { StationRow } from "../packages/commute/src/sources/seoul-subway";
import type { SubwayObservation } from "../packages/realtime/src/observation";
import {
	type BusTarget,
	busResponsesOf,
	busSamplesFor,
	type SubwaySnapshot,
	type SubwayTarget,
	subwaySamplesFor,
} from "./leave-margin-samples";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
/** 2026-11-10(화) 08:00 KST. */
const BASE = Date.UTC(2026, 10, 9, 23, 0);
/** 수집기가 응답을 받기까지 걸린 시간. */
const FETCH_DELAY_MS = 2 * SECOND_MS;

/** 08:mm:ss */
function at(minute: number, second = 0): number {
	return BASE + minute * MINUTE_MS + second * SECOND_MS;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** 08:mm:ss의 서울 버스 `mkTm`. */
function mkTmOf(minute: number, second = 0): string {
	return `2026-11-10 08:${pad(minute)}:${pad(second)}.0`;
}

// ── 지하철 ──────────────────────────────────────────────────────────

const STATN = "1002000222";
const TRAIN = "2234";
const SUBWAY_TARGET: SubwayTarget = {
	direction: "up",
	line: "seoul-subway:line2",
	mode: "subway",
	statnId: STATN,
};

function stationRow(sourceAt: number, barvlSec: number): StationRow {
	return {
		arvlCd: "99",
		barvlSec,
		direction: "up",
		ordkey: "01000강남0",
		sourceAt,
		trainNo: TRAIN,
	};
}

function snapshot(fetchedAt: number, rows: StationRow[]): SubwaySnapshot {
	return { fetchedAt, rows: new Map([[STATN, rows]]) };
}

function arriveEvent(observedAt: number, sourceAt: number): SubwayObservation {
	return {
		destinationStatnId: null,
		direction: "up",
		express: false,
		lastTrain: false,
		lineKey: "line2",
		matchStatus: "matched",
		observedAt,
		qualityFlags: [],
		rawTrainNo: TRAIN,
		source: "arrival-all",
		sourceAt,
		sourceAtKind: "state-change",
		sourceAtRaw: "",
		stationDistanceM: null,
		statnId: STATN,
		status: "arrive",
		trackShapeId: null,
		tripId: null,
	};
}

describe("subwaySamplesFor", () => {
	test("low는 arrive 이벤트를 낸 스냅샷 바로 앞 스냅샷의 원천 시각, high는 arrive 이벤트 시각이다", () => {
		const snapshots = [
			snapshot(at(0, 10), [stationRow(at(0), 180)]),
			snapshot(at(1, 10), [stationRow(at(1), 120)]),
			// 이벤트를 낸 스냅샷: 그 역 행의 시각(08:01:40)이 이벤트 시각(08:01:45)보다 이르다.
			snapshot(at(2, 10), [stationRow(at(1, 40), 0)]),
		];
		const samples = subwaySamplesFor(
			SUBWAY_TARGET,
			snapshots,
			[arriveEvent(at(2, 10), at(1, 45))],
			0
		);
		expect(samples).toHaveLength(1);
		const [sample] = samples;
		expect(sample?.low).toBe(at(1));
		expect(sample?.high).toBe(at(1, 45));
		expect(sample?.predictions.map((prediction) => prediction.at)).toEqual([
			at(0, 10),
			at(1, 10),
		]);
	});
});

// ── 버스 ────────────────────────────────────────────────────────────

const ROUTE = "100100118";
const OTHER_ROUTE = "100100029";
const TARGET_SEQ = 5;
const TARGET_ST_ID = "112000005";
const VEHICLE = "111033115";
const OTHER_VEHICLE = "111039999";

interface Slot {
	sectOrd?: string;
	traTime?: string;
	vehId: string;
}

interface ItemOptions {
	busRouteId?: string | null;
	mkTm: string;
	seq: number;
	slots?: Slot[];
	stId?: string;
}

/** `getArrInfoByRouteAll`의 정류장 칸 하나(문자열 필드 그대로). */
function busItem({
	busRouteId = ROUTE,
	mkTm,
	seq,
	slots = [],
	stId = `11200000${seq}`,
}: ItemOptions): Record<string, string> {
	const item: Record<string, string> = {
		mkTm,
		staOrd: String(seq),
		stId,
		term: "8",
	};
	if (busRouteId !== null) {
		item.busRouteId = busRouteId;
	}
	for (const n of [1, 2] as const) {
		const slot = slots[n - 1];
		item[`vehId${n}`] = slot?.vehId ?? "0";
		item[`traTime${n}`] = slot?.traTime ?? "0";
		item[`sectOrd${n}`] = slot?.sectOrd ?? "0";
		item[`isArrive${n}`] = "0";
		item[`isLast${n}`] = "0";
		item[`plainNo${n}`] = slot ? `서울74사${n}00${n}` : " ";
		item[`arrmsg${n}`] = slot ? "3분후[1번째 전]" : "운행종료";
	}
	return item;
}

/** 대상 정류장으로 다가오는 차량 칸(한 정류장 전, 60초 뒤). */
const approaching = (vehId = VEHICLE): Slot => ({
	sectOrd: String(TARGET_SEQ - 1),
	traTime: "60",
	vehId,
});

/** 대상 정류장 앞뒤 정류장까지 담은 응답의 정류장들. 대상 정류장 칸은 `target`으로 바꾼다. */
function routeItems(
	minute: number,
	target: Partial<ItemOptions> | null,
	busRouteId: string | null = ROUTE
): Record<string, string>[] {
	const mkTm = mkTmOf(minute);
	const items = [
		busItem({ busRouteId, mkTm, seq: TARGET_SEQ - 1 }),
		busItem({ busRouteId, mkTm, seq: TARGET_SEQ + 1 }),
	];
	if (target !== null) {
		items.push(
			busItem({
				busRouteId,
				mkTm,
				seq: TARGET_SEQ,
				stId: TARGET_ST_ID,
				...target,
			})
		);
	}
	return items;
}

/** `/dump` 한 줄. `routeId`가 null이면 줄에 노선을 적지 않는다. */
function dumpLine(
	minute: number,
	items: Record<string, string>[],
	routeId: string | null = ROUTE
): Record<string, unknown> {
	return {
		body: JSON.stringify({
			msgBody: { itemList: items },
			msgHeader: { headerCd: "0" },
		}),
		fetchedAt: at(minute) + FETCH_DELAY_MS,
		...(routeId === null ? {} : { routeId }),
	};
}

function busTarget(seq: number | null): BusTarget {
	return {
		line: `seoul-bus:${ROUTE}`,
		mode: "bus",
		routeId: ROUTE,
		seq,
		stId: TARGET_ST_ID,
	};
}

function busSamples(target: BusTarget, lines: unknown[]) {
	const { dropped, responses } = busResponsesOf(lines);
	return { dropped, ...busSamplesFor(target, responses) };
}

const spans = (samples: { high: number; low: number }[]) =>
	samples.map(({ high, low }) => ({ high, low }));

describe("busSamplesFor", () => {
	test("목록에 있던 차량이 다음 응답에서 사라지면 그 사이에 도착한 것이다", () => {
		const { samples } = busSamples(busTarget(TARGET_SEQ), [
			dumpLine(0, routeItems(0, { slots: [approaching()] })),
			dumpLine(1, routeItems(1, { slots: [approaching()] })),
			dumpLine(2, routeItems(2, {})),
		]);
		expect(spans(samples)).toEqual([{ high: at(2), low: at(1) }]);
	});

	test.each([
		["정류장 칸의 mkTm이 깨진 응답", { mkTm: "깨짐" }],
		["정류장 칸이 빠진 응답", null],
	] as const)("seq를 준 대상: %s은 관측으로 쓰지 않는다", (_, broken) => {
		const { samples, skipped } = busSamples(busTarget(TARGET_SEQ), [
			dumpLine(0, routeItems(0, { slots: [approaching()] })),
			dumpLine(1, routeItems(1, broken)),
			dumpLine(2, routeItems(2, { slots: [approaching()] })),
			dumpLine(3, routeItems(3, {})),
		]);
		expect(spans(samples)).toEqual([{ high: at(3), low: at(2) }]);
		expect(skipped.stopMissing).toBe(1);
	});

	test.each([
		["traTime", { traTime: "" }],
		["sectOrd", { sectOrd: "" }],
	] as const)(
		"대상 정류장의 차량 칸 %s이 비면 그 응답에서 사라짐을 보지 않는다",
		(_, broken) => {
			for (const seq of [TARGET_SEQ, null]) {
				const { samples, skipped } = busSamples(busTarget(seq), [
					dumpLine(0, routeItems(0, { slots: [approaching()] })),
					dumpLine(
						1,
						routeItems(1, { slots: [{ ...approaching(), ...broken }] })
					),
					dumpLine(2, routeItems(2, { slots: [approaching()] })),
					dumpLine(3, routeItems(3, {})),
				]);
				expect(spans(samples)).toEqual([{ high: at(3), low: at(2) }]);
				expect(skipped.vehicleUnparsed).toBe(1);
			}
		}
	);

	test("줄에 노선이 없으면 응답 칸의 busRouteId로 다른 노선을 뺀다", () => {
		const otherRoute = (minute: number) =>
			dumpLine(
				minute,
				routeItems(
					minute,
					{ slots: [approaching(OTHER_VEHICLE)] },
					OTHER_ROUTE
				).map((item) => ({ ...item, mkTm: mkTmOf(minute, 30) })),
				null
			);
		const { dropped, samples, skipped } = busSamples(busTarget(TARGET_SEQ), [
			dumpLine(0, routeItems(0, { slots: [approaching()] }), null),
			{ ...otherRoute(0), fetchedAt: at(0, 30) + FETCH_DELAY_MS },
			dumpLine(1, routeItems(1, { slots: [approaching()] }), null),
			{ ...otherRoute(1), fetchedAt: at(1, 30) + FETCH_DELAY_MS },
			dumpLine(2, routeItems(2, {}), null),
		]);
		expect(spans(samples)).toEqual([{ high: at(2), low: at(1) }]);
		expect(skipped.otherRoute).toBe(2);
		expect(dropped).toEqual({});
	});

	test("줄과 응답 칸 어디에도 노선이 없으면 그 줄을 뺀다", () => {
		const { dropped, samples } = busSamples(busTarget(TARGET_SEQ), [
			dumpLine(0, routeItems(0, { slots: [approaching()] })),
			dumpLine(1, routeItems(1, {}, null), null),
			dumpLine(2, routeItems(2, { slots: [approaching()] })),
			dumpLine(3, routeItems(3, {})),
		]);
		expect(spans(samples)).toEqual([{ high: at(3), low: at(2) }]);
		expect(dropped).toEqual({ noRoute: 1 });
	});

	test("실패·빈 응답과 읽을 수 없는 줄은 이유별로 센다", () => {
		const failed = {
			body: JSON.stringify({ msgHeader: { headerCd: "7" } }),
			fetchedAt: at(0),
			routeId: ROUTE,
		};
		const empty = {
			body: JSON.stringify({ msgHeader: { headerCd: "4" } }),
			fetchedAt: at(1),
			routeId: ROUTE,
		};
		const { dropped } = busResponsesOf([failed, empty, null, { body: "{}" }]);
		expect(dropped).toEqual({ empty: 1, failed: 1, malformed: 2 });
	});
});

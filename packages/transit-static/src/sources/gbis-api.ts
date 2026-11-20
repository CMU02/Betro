import {
	fail,
	isRecord,
	parseClockMinute,
	type RawRecord,
	type RegionalEnvelope,
	type RegionalRouteInfo,
	type RegionalRouteRow,
	type RegionalStopRow,
	readGatewayFailure,
	readHeadway,
	readNumber,
	readText,
	toArray,
} from "./regional-bus-types";

const GBIS_BASE = "https://apis.data.go.kr/6410000/busrouteservice/v2";
const REGION_SEPARATOR = ",";

// msgHeader.resultCode: 0 정상, 1 시스템 에러, 2 필수 파라미터 없음, 4 결과 없음
const RESULT_OK = 0;
const RESULT_SYSTEM_ERROR = 1;
const RESULT_NO_DATA = 4;

export type GbisOperation =
	| "getBusRouteListv2"
	| "getBusRouteInfoItemv2"
	| "getBusRouteStationListv2";

/** 키는 `serviceKey`로 넘기고 응답은 JSON으로 받는다. 로그에 쓸 때는 `maskKey`를 거친다. */
export function gbisUrl(
	operation: GbisOperation,
	params: Record<string, string>,
	key: string
): string {
	const query = new URLSearchParams({
		format: "json",
		serviceKey: key,
		...params,
	});
	return `${GBIS_BASE}/${operation}?${query.toString()}`;
}

type BodyRead =
	| { ok: true; body: RawRecord }
	| {
			ok: false;
			reason: "no-data" | "quota" | "auth" | "temporary" | "malformed";
	  };

function readBody(json: unknown): BodyRead {
	const gateway = readGatewayFailure(json);
	if (gateway !== null) {
		return { ok: false, reason: gateway };
	}
	if (!(isRecord(json) && isRecord(json.response))) {
		return { ok: false, reason: "malformed" };
	}
	const { msgHeader, msgBody } = json.response;
	const code = isRecord(msgHeader) ? readNumber(msgHeader.resultCode) : null;
	if (code === RESULT_NO_DATA) {
		return { ok: false, reason: "no-data" };
	}
	if (code === RESULT_SYSTEM_ERROR) {
		return { ok: false, reason: "temporary" };
	}
	if (code !== RESULT_OK) {
		return { ok: false, reason: "malformed" };
	}
	if (!isRecord(msgBody)) {
		return { ok: false, reason: "no-data" };
	}
	return { body: msgBody, ok: true };
}

function readItems<T>(
	json: unknown,
	listKey: string,
	toRow: (raw: RawRecord) => T | null
): RegionalEnvelope<T> {
	const read = readBody(json);
	if (!read.ok) {
		return fail(read.reason);
	}
	const items: T[] = [];
	for (const raw of toArray(read.body[listKey])) {
		if (!isRecord(raw)) {
			return fail("malformed");
		}
		const row = toRow(raw);
		if (row === null) {
			return fail("malformed");
		}
		items.push(row);
	}
	return items.length === 0 ? fail("no-data") : { items, ok: true };
}

/** `regionName`은 쉼표로 이은 시·군이다. 첫 시·군을 지역 이름으로 쓴다. */
function firstRegion(value: unknown): string | null {
	const text = readText(value);
	if (text === null) {
		return null;
	}
	const [first] = text.split(REGION_SEPARATOR);
	const trimmed = first?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

function toRouteRow(raw: RawRecord): RegionalRouteRow | null {
	const routeId = readText(raw.routeId);
	const name = readText(raw.routeName);
	const routeTypeCode = readText(raw.routeTypeCd);
	if (routeId === null || name === null || routeTypeCode === null) {
		return null;
	}
	return {
		areaName: firstRegion(raw.regionName),
		cityCode: null,
		name,
		routeId,
		routeTypeCode,
	};
}

export function parseGbisRouteList(
	json: unknown
): RegionalEnvelope<RegionalRouteRow> {
	return readItems(json, "busRouteList", toRouteRow);
}

function minOf(values: (number | null)[]): number | null {
	const present = values.filter((value): value is number => value !== null);
	return present.length === 0 ? null : Math.min(...present);
}

function maxOf(values: (number | null)[]): number | null {
	const present = values.filter((value): value is number => value !== null);
	return present.length === 0 ? null : Math.max(...present);
}

/**
 * 평일 기준이다. 배차간격은 출퇴근 시간대(`peekAlloc`)를 먼저 쓰고 없으면 그 밖(`nPeekAlloc`)을 쓴다.
 * 첫차·막차는 상행·하행 중 가장 이른 첫차와 가장 늦은 막차다.
 */
function toRouteInfo(raw: RawRecord): RegionalRouteInfo {
	return {
		firstBusMinute: minOf([
			parseClockMinute(raw.upFirstTime),
			parseClockMinute(raw.downFirstTime),
		]),
		headwayMin: readHeadway(raw.peekAlloc) ?? readHeadway(raw.nPeekAlloc),
		lastBusMinute: maxOf([
			parseClockMinute(raw.upLastTime),
			parseClockMinute(raw.downLastTime),
		]),
	};
}

export function parseGbisRouteInfo(
	json: unknown
): RegionalEnvelope<RegionalRouteInfo> {
	return readItems(json, "busRouteInfoItem", toRouteInfo);
}

function toStopRow(raw: RawRecord): RegionalStopRow | null {
	const stationId = readText(raw.stationId);
	const name = readText(raw.stationName);
	const seq = readNumber(raw.stationSeq);
	// x는 경도, y는 위도다.
	const lng = readNumber(raw.x);
	const lat = readNumber(raw.y);
	if (
		stationId === null ||
		name === null ||
		seq === null ||
		lat === null ||
		lng === null
	) {
		return null;
	}
	const turnSeq = readNumber(raw.turnSeq);
	return {
		arsId: readText(raw.mobileNo),
		lat,
		lng,
		name,
		seq,
		stationId,
		turnSeq: turnSeq !== null && turnSeq > 0 ? turnSeq : null,
	};
}

export function parseGbisRouteStations(
	json: unknown
): RegionalEnvelope<RegionalStopRow> {
	const result = readItems(json, "busRouteStationList", toStopRow);
	if (!result.ok) {
		return result;
	}
	return { items: [...result.items].sort((a, b) => a.seq - b.seq), ok: true };
}

import {
	fail,
	isRecord,
	parseClockMinute,
	type RawRecord,
	type RegionalEnvelope,
	type RegionalFailReason,
	type RegionalRouteInfo,
	type RegionalRouteRow,
	type RegionalStopRow,
	readGatewayFailure,
	readHeadway,
	readNumber,
	readText,
	toArray,
} from "./regional-bus-types";

const TAGO_BASE = "https://apis.data.go.kr/1613000/BusRouteInfoInqireService";
const INCHEON_CITY_CODE = "23";
const INCHEON_AREA_NAME = "인천";

// header.resultCode: "00" 정상, "03" 데이터 없음, "04" HTTP 에러, "05" 연결 실패 등
const RESULT_OK = "00";
const RESULT_NO_DATA = "03";
const RESULT_QUOTA = "22";
const TEMPORARY_RESULTS = new Set(["01", "04", "05"]);
const AUTH_RESULTS = new Set(["20", "30", "31", "32", "33"]);

export type TagoOperation =
	| "getRouteNoList"
	| "getRouteInfoIem"
	| "getRouteAcctoThrghSttnList";

/** 키는 `serviceKey`로 넘기고 응답은 JSON으로 받는다. 로그에 쓸 때는 `maskKey`를 거친다. */
export function tagoUrl(
	operation: TagoOperation,
	params: Record<string, string>,
	key: string,
	cityCode: string
): string {
	const query = new URLSearchParams({
		_type: "json",
		cityCode,
		serviceKey: key,
		...params,
	});
	return `${TAGO_BASE}/${operation}?${query.toString()}`;
}

type BodyRead =
	| { ok: true; items: unknown[] }
	| { ok: false; reason: RegionalFailReason };

function failureOfResultCode(code: string): RegionalFailReason {
	if (code === RESULT_NO_DATA) {
		return "no-data";
	}
	if (code === RESULT_QUOTA) {
		return "quota";
	}
	if (AUTH_RESULTS.has(code)) {
		return "auth";
	}
	if (TEMPORARY_RESULTS.has(code)) {
		return "temporary";
	}
	return "malformed";
}

function readBody(json: unknown): BodyRead {
	const gateway = readGatewayFailure(json);
	if (gateway !== null) {
		return { ok: false, reason: gateway };
	}
	if (!(isRecord(json) && isRecord(json.response))) {
		return { ok: false, reason: "malformed" };
	}
	const { header, body } = json.response;
	const code = isRecord(header) ? readText(header.resultCode) : null;
	if (code === null) {
		return { ok: false, reason: "malformed" };
	}
	if (code !== RESULT_OK) {
		return { ok: false, reason: failureOfResultCode(code) };
	}
	if (!isRecord(body)) {
		return { ok: false, reason: "no-data" };
	}
	// items가 빈 문자열로 오는 응답이 있다. 항목이 하나이면 배열이 아니라 객체다.
	const items = isRecord(body.items) ? body.items.item : undefined;
	return { items: toArray(items), ok: true };
}

function readItems<T>(
	json: unknown,
	toRow: (raw: RawRecord) => T | null
): RegionalEnvelope<T> {
	const read = readBody(json);
	if (!read.ok) {
		return fail(read.reason);
	}
	const rows: T[] = [];
	for (const raw of read.items) {
		if (!isRecord(raw)) {
			return fail("malformed");
		}
		const row = toRow(raw);
		if (row === null) {
			return fail("malformed");
		}
		rows.push(row);
	}
	return rows.length === 0 ? fail("no-data") : { items: rows, ok: true };
}

export function parseTagoRouteList(
	json: unknown,
	cityCode: string
): RegionalEnvelope<RegionalRouteRow> {
	return readItems(json, (raw) => {
		const routeId = readText(raw.routeid);
		const name = readText(raw.routeno);
		const routeTypeCode = readText(raw.routetp);
		if (routeId === null || name === null || routeTypeCode === null) {
			return null;
		}
		return {
			areaName: cityCode === INCHEON_CITY_CODE ? INCHEON_AREA_NAME : null,
			cityCode,
			name,
			routeId,
			routeTypeCode,
		};
	});
}

/**
 * 배차간격은 `intervaltime` 하나뿐이고 요일·방향 구분이 없다.
 * 막차 `0000`(자정)은 0으로 보아 null이다.
 */
export function parseTagoRouteInfo(
	json: unknown,
	_cityCode: string
): RegionalEnvelope<RegionalRouteInfo> {
	return readItems(json, (raw) => ({
		firstBusMinute: parseClockMinute(raw.startvehicletime),
		headwayMin: readHeadway(raw.intervaltime),
		lastBusMinute: parseClockMinute(raw.endvehicletime),
	}));
}

export function parseTagoRouteStations(
	json: unknown,
	_cityCode: string
): RegionalEnvelope<RegionalStopRow> {
	const result = readItems(json, (raw): RegionalStopRow | null => {
		const stationId = readText(raw.nodeid);
		const name = readText(raw.nodenm);
		const seq = readNumber(raw.nodeord);
		// 좌표는 숫자와 문자열이 섞여 온다.
		const lat = readNumber(raw.gpslati);
		const lng = readNumber(raw.gpslong);
		if (
			stationId === null ||
			name === null ||
			seq === null ||
			lat === null ||
			lng === null
		) {
			return null;
		}
		return {
			arsId: readText(raw.nodeno),
			lat,
			lng,
			name,
			seq,
			stationId,
			turnSeq: null,
			upDown: readNumber(raw.updowncd),
		};
	});
	if (!result.ok) {
		return result;
	}
	return { items: [...result.items].sort((a, b) => a.seq - b.seq), ok: true };
}

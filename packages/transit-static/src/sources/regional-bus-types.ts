// 경기(GBIS)·인천(TAGO) 파서가 함께 쓰는 행 타입과 공용 도우미.
export interface RegionalRouteRow {
	areaName: string | null;
	cityCode: string | null;
	name: string;
	routeId: string;
	routeTypeCode: string;
}

export interface RegionalRouteInfo {
	firstBusMinute: number | null;
	headwayMin: number | null;
	lastBusMinute: number | null;
}

export interface RegionalStopRow {
	arsId: string | null;
	lat: number;
	lng: number;
	name: string;
	seq: number;
	stationId: string;
	turnSeq: number | null;
	/** TAGO `updowncd`. 방향이 바뀌는 지점을 알려 준다. GBIS는 null이다. */
	upDown: number | null;
}

export type RegionalFailReason =
	| "no-data"
	| "quota"
	| "auth"
	| "temporary"
	| "malformed";

export type RegionalEnvelope<T> =
	| { ok: true; items: T[] }
	| { ok: false; reason: RegionalFailReason };

export type RawRecord = Record<string, unknown>;

const TIME_COLON_RE = /^(\d{1,2}):(\d{2})$/;
const TIME_DIGITS_RE = /^\d{3,4}$/;
const MINUTES_PER_HOUR = 60;
const MAX_HOUR = 29;
const HHMM_DIVISOR = 100;

export function isRecord(value: unknown): value is RawRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 단일 항목 응답도 배열 하나로 감싼다. 없으면 빈 배열이다. */
export function toArray(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (value === undefined || value === null || value === "") {
		return [];
	}
	return [value];
}

export function readText(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed === "" ? null : trimmed;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return null;
}

/** 숫자와 숫자 문자열이 섞여 오는 값을 숫자로 읽는다. */
export function readNumber(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/** `HHmm`, `HH:mm`(숫자 포함)을 0시부터의 분으로 바꾼다. 비었거나 0이면 null이다. */
export function parseClockMinute(value: unknown): number | null {
	const text = readText(value);
	if (text === null) {
		return null;
	}
	let hour: number;
	let minute: number;
	const colon = TIME_COLON_RE.exec(text);
	if (colon) {
		hour = Number(colon[1]);
		minute = Number(colon[2]);
	} else if (TIME_DIGITS_RE.test(text)) {
		const packed = Number(text);
		hour = Math.floor(packed / HHMM_DIVISOR);
		minute = packed % HHMM_DIVISOR;
	} else {
		return null;
	}
	if (minute >= MINUTES_PER_HOUR || hour > MAX_HOUR) {
		return null;
	}
	const total = hour * MINUTES_PER_HOUR + minute;
	return total === 0 ? null : total;
}

/** 배차간격(분). 0 이하이면 null이다. */
export function readHeadway(value: unknown): number | null {
	const parsed = readNumber(value);
	return parsed !== null && parsed > 0 ? parsed : null;
}

export function fail<T>(reason: RegionalFailReason): RegionalEnvelope<T> {
	return { ok: false, reason };
}

/** data.go.kr 게이트웨이 에러 봉투(`OpenAPI_ServiceResponse`)를 읽어 실패 이유로 바꾼다. */
export function readGatewayFailure(json: unknown): RegionalFailReason | null {
	if (!isRecord(json)) {
		return null;
	}
	const envelope = json.OpenAPI_ServiceResponse;
	if (!isRecord(envelope)) {
		return null;
	}
	const header = envelope.cmmMsgHeader;
	if (!isRecord(header)) {
		return "malformed";
	}
	const authMsg = readText(header.returnAuthMsg) ?? "";
	const code = readText(header.returnReasonCode) ?? "";
	if (authMsg.includes("LIMITED_NUMBER_OF_SERVICE_REQUESTS") || code === "22") {
		return "quota";
	}
	if (AUTH_CODES.has(code)) {
		return "auth";
	}
	if (TEMPORARY_CODES.has(code)) {
		return "temporary";
	}
	return "malformed";
}

// 20 접근 거부, 30 미등록 키, 31 기간 만료, 32 미등록 IP, 33 서명 불일치
const AUTH_CODES = new Set(["20", "30", "31", "32", "33"]);
// 1 어플리케이션 에러, 4 HTTP 에러, 5 서비스 연결 실패
const TEMPORARY_CODES = new Set(["1", "01", "4", "04", "5", "05"]);

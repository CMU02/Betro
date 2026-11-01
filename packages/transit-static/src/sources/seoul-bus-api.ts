// ws.bus.go.kr은 HTTP만 응답하고 HTTPS는 시간 초과다(조사 보고서 2장).
// 서비스키가 평문으로 전송되므로 서버 측 수집 경로로만 쓴다.
const BUS_ROUTE_INFO_BASE = "http://ws.bus.go.kr/api/rest/busRouteInfo";
const DEFAULT_TIMEOUT_MS = 10_000;
const DETAIL_MAX_CHARS = 200;
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

const REASON_XML_RE = /returnReasonCode>\s*(\d+)\s*</;
const REASON_JSON_RE = /"returnReasonCode"\s*:\s*"?(\d+)/;
const QUOTA_TEXT = "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS";

export type BusRouteOperation = "getStaionByRoute" | "getRoutePath";

export type BusEnvelope =
	| { kind: "ok"; items: Record<string, unknown>[] }
	| { kind: "route-not-found" }
	| { kind: "quota-exceeded"; detail: string }
	| { kind: "rate-limited"; detail: string }
	| { kind: "unauthorized"; detail: string }
	| { kind: "retryable"; detail: string }
	| { kind: "error"; detail: string };

export interface BusRouteStationRow {
	apiSectDistM: number;
	arsId: string | null;
	directionName: string | null;
	lat: number;
	lng: number;
	name: string;
	routeName: string;
	routeType: string;
	seq: number;
	stationId: string;
}

type RawItem = Record<string, unknown>;

export function busRouteInfoUrl(
	operation: BusRouteOperation,
	key: string,
	busRouteId: string
): string {
	return `${BUS_ROUTE_INFO_BASE}/${operation}?serviceKey=${encodeURIComponent(key)}&busRouteId=${encodeURIComponent(busRouteId)}&resultType=json`;
}

/** 키 원문과 인코딩된 키를 모두 `<key>`로 가린다. */
export function maskKey(input: string, key: string): string {
	if (key === "") {
		return input;
	}
	return input
		.split(encodeURIComponent(key))
		.join("<key>")
		.split(key)
		.join("<key>");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readHeader(
	bodyText: string
):
	| { code: string; message: string; json: Record<string, unknown> }
	| undefined {
	let json: unknown;
	try {
		json = JSON.parse(bodyText);
	} catch {
		return undefined;
	}
	if (!(isRecord(json) && isRecord(json.msgHeader))) {
		return undefined;
	}
	const { headerCd, headerMsg } = json.msgHeader;
	if (headerCd === undefined || headerCd === null) {
		return undefined;
	}
	return {
		code: String(headerCd).trim(),
		json,
		message: typeof headerMsg === "string" ? headerMsg : "",
	};
}

function readReasonCode(bodyText: string): string | undefined {
	return (
		REASON_XML_RE.exec(bodyText)?.[1] ?? REASON_JSON_RE.exec(bodyText)?.[1]
	);
}

function readItems(json: Record<string, unknown>): RawItem[] {
	const body = json.msgBody;
	if (!isRecord(body)) {
		return [];
	}
	// 게이트웨이가 항목 1개짜리 목록을 객체로 내려보내는 경우를 배열로 감싼다.
	if (isRecord(body.itemList) && !Array.isArray(body.itemList)) {
		return [body.itemList];
	}
	if (!Array.isArray(body.itemList)) {
		return [];
	}
	return body.itemList.filter(isRecord);
}

function classifyHeader(header: {
	code: string;
	message: string;
	json: Record<string, unknown>;
}): BusEnvelope {
	const detail = `headerCd ${header.code}: ${header.message}`;
	switch (header.code) {
		case "0":
			return { items: readItems(header.json), kind: "ok" };
		case "4":
			return { kind: "route-not-found" };
		case "7":
			return { detail, kind: "unauthorized" };
		case "8":
			return { detail, kind: "rate-limited" };
		case "1":
		case "6":
			return { detail, kind: "retryable" };
		default:
			return { detail, kind: "error" };
	}
}

/**
 * 판정 순서는 계획의 표 우선순위를 따른다.
 * key를 넘기면 본문을 자르기 전에 먼저 가려서, 200자 경계에 걸린 키 조각이 새지 않게 한다.
 */
export function parseBusEnvelope(
	status: number,
	bodyText: string,
	key = ""
): BusEnvelope {
	const snippet = maskKey(bodyText, key).slice(0, DETAIL_MAX_CHARS);
	const header = readHeader(bodyText);
	if (status === HTTP_UNAUTHORIZED || header?.code === "7") {
		return { detail: `HTTP ${status}: ${snippet}`, kind: "unauthorized" };
	}
	const reason = readReasonCode(bodyText);
	if (
		status === HTTP_TOO_MANY_REQUESTS ||
		reason === "22" ||
		bodyText.includes(QUOTA_TEXT)
	) {
		return { detail: `HTTP ${status}: ${snippet}`, kind: "quota-exceeded" };
	}
	if (reason === "23" || header?.code === "8") {
		return { detail: `HTTP ${status}: ${snippet}`, kind: "rate-limited" };
	}
	if (status >= HTTP_SERVER_ERROR) {
		return { detail: `HTTP ${status}: ${snippet}`, kind: "retryable" };
	}
	// 2xx가 아닌 나머지 상태(403, 404 등)는 headerCd가 0이어도 정상으로 보지 않는다.
	if (!header || status < HTTP_OK_MIN || status > HTTP_OK_MAX) {
		return { detail: `HTTP ${status}: ${snippet}`, kind: "error" };
	}
	return classifyHeader(header);
}

function toNumber(value: unknown): number | undefined {
	// null, 불리언, 배열, 객체는 Number()가 0/1로 바꾸므로 먼저 걸러낸다.
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value !== "string" || value.trim() === "") {
		return undefined;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function text(value: unknown): string {
	return value === null || value === undefined ? "" : String(value).trim();
}

function parseStation(
	item: RawItem
): { row: BusRouteStationRow } | { error: string } {
	const seq = toNumber(item.seq);
	if (seq === undefined || !Number.isInteger(seq) || seq < 1) {
		return { error: `seq ${text(item.seq)}: invalid seq` };
	}
	const lng = toNumber(item.gpsX);
	if (lng === undefined) {
		return { error: `seq ${seq}: invalid gpsX` };
	}
	const lat = toNumber(item.gpsY);
	if (lat === undefined) {
		return { error: `seq ${seq}: invalid gpsY` };
	}
	const apiSectDistM = toNumber(item.fullSectDist);
	// DB 컬럼이 정수이므로 음수와 소수는 거른다.
	if (
		apiSectDistM === undefined ||
		!Number.isInteger(apiSectDistM) ||
		apiSectDistM < 0
	) {
		return { error: `seq ${seq}: invalid fullSectDist` };
	}
	const stationId = text(item.station);
	if (stationId === "") {
		return { error: `seq ${seq}: missing station` };
	}
	const arsId = text(item.arsId);
	const directionName = text(item.direction);
	return {
		row: {
			apiSectDistM,
			arsId: arsId === "" || arsId === "0" ? null : arsId,
			directionName: directionName === "" ? null : directionName,
			lat,
			lng,
			name: text(item.stationNm),
			routeName: text(item.busRouteNm),
			routeType: text(item.routeType),
			seq,
			stationId,
		},
	};
}

export function parseRouteStations(items: RawItem[]): {
	rows: BusRouteStationRow[];
	errors: string[];
} {
	const rows: BusRouteStationRow[] = [];
	const errors: string[] = [];
	for (const item of items) {
		const parsed = parseStation(item);
		if ("error" in parsed) {
			errors.push(parsed.error);
		} else {
			rows.push(parsed.row);
		}
	}
	return { errors, rows };
}

export function parseRoutePath(items: RawItem[]): {
	coords: [number, number][];
	errors: string[];
} {
	const points: { no: number; coord: [number, number] }[] = [];
	const errors: string[] = [];
	for (const item of items) {
		const no = toNumber(item.no);
		const lng = toNumber(item.gpsX);
		const lat = toNumber(item.gpsY);
		if (no === undefined || lng === undefined || lat === undefined) {
			errors.push(`no ${text(item.no)}: invalid point`);
			continue;
		}
		points.push({ coord: [lng, lat], no });
	}
	points.sort((a, b) => a.no - b.no);
	return { coords: points.map((point) => point.coord), errors };
}

/**
 * 반환하는 bodyText는 가리지 않은 원문이다. kind가 "ok"일 때만 저장해야 하며,
 * 오류 응답 본문은 키를 되풀이할 수 있으므로 저장하거나 출력하지 않는다.
 */
export async function fetchBusRouteOperation(options: {
	operation: BusRouteOperation;
	key: string;
	busRouteId: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}): Promise<{ envelope: BusEnvelope; bodyText: string }> {
	const { operation, key, busRouteId } = options;
	const fetchImpl = options.fetchImpl ?? fetch;
	const url = busRouteInfoUrl(operation, key, busRouteId);
	try {
		const response = await fetchImpl(url, {
			signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
		const bodyText = await response.text();
		const envelope = parseBusEnvelope(response.status, bodyText, key);
		return {
			bodyText,
			envelope:
				"detail" in envelope
					? { ...envelope, detail: maskKey(envelope.detail, key) }
					: envelope,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			bodyText: "",
			envelope: {
				detail: maskKey(`${operation} request failed: ${message}`, key),
				kind: "retryable",
			},
		};
	}
}

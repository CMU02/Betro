export interface RegionalPositionRow {
	lat: number | null;
	lng: number | null;
	plate: string;
	seq: number;
	vehId: string;
}

export type RegionalOutcome =
	| "ok"
	| "no-data"
	| "temporary"
	| "rate-limited"
	| "quota-exhausted"
	| "auth"
	| "malformed";

interface Parsed {
	outcome: RegionalOutcome;
	rows: RegionalPositionRow[];
}

const GBIS_BASE = "https://apis.data.go.kr/6410000/buslocationservice/v2";
const TAGO_BASE = "https://apis.data.go.kr/1613000/BusLcInfoInqireService";

const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;
const GBIS_OK = 0;
const GBIS_NO_DATA = 4;
const GATEWAY_QUOTA = "22";
const GATEWAY_RATE = "23";
const GATEWAY_AUTH = new Set(["20", "30", "31", "32", "33"]);
const TAGO_OK = "00";
const TAGO_NO_DATA = "03";

export function gbisPositionUrl(key: string, routeId: string): string {
	return `${GBIS_BASE}/getBusLocationListv2?serviceKey=${encodeURIComponent(key)}&routeId=${routeId}&format=json`;
}

export function tagoPositionUrl(
	key: string,
	cityCode: string,
	routeId: string
): string {
	return `${TAGO_BASE}/getRouteAcctoBusLcList?serviceKey=${encodeURIComponent(key)}&cityCode=${cityCode}&routeId=${routeId}&numOfRows=200&_type=json`;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toArray(v: unknown): unknown[] {
	if (Array.isArray(v)) {
		return v;
	}
	return isObj(v) ? [v] : [];
}

function num(v: unknown): number | null {
	const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
	return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
	if (typeof v === "string" && v !== "") {
		return v;
	}
	return typeof v === "number" ? String(v) : null;
}

function failed(outcome: RegionalOutcome): Parsed {
	return { outcome, rows: [] };
}

function gatewayOutcome(code: string): RegionalOutcome {
	if (code === GATEWAY_QUOTA) {
		return "quota-exhausted";
	}
	if (code === GATEWAY_RATE) {
		return "rate-limited";
	}
	return GATEWAY_AUTH.has(code) ? "auth" : "temporary";
}

function statusOutcome(status: number): RegionalOutcome | null {
	if (status === HTTP_UNAUTHORIZED) {
		return "auth";
	}
	if (status === HTTP_TOO_MANY) {
		return "quota-exhausted";
	}
	return status >= HTTP_SERVER_ERROR ? "temporary" : null;
}

function finish(rows: RegionalPositionRow[], total: number): Parsed {
	if (total === 0) {
		return failed("no-data");
	}
	return rows.length > 0 ? { outcome: "ok", rows } : failed("malformed");
}

function gbisRow(item: unknown): RegionalPositionRow | null {
	if (!isObj(item)) {
		return null;
	}
	const vehId = str(item.vehId);
	const seq = num(item.stationSeq);
	if (vehId === null || seq === null) {
		return null;
	}
	return {
		lat: null,
		lng: null,
		plate: str(item.plateNo) ?? "",
		seq,
		vehId,
	};
}

function parseGbis(response: Obj): Parsed {
	const { msgHeader: header } = response;
	if (!isObj(header)) {
		return failed("malformed");
	}
	const code = num(header.resultCode);
	if (code === GBIS_NO_DATA) {
		return failed("no-data");
	}
	if (code !== GBIS_OK) {
		return failed(code === null ? "malformed" : "temporary");
	}
	const body = response.msgBody;
	const items = isObj(body) ? toArray(body.busLocationList) : [];
	const rows: RegionalPositionRow[] = [];
	for (const item of items) {
		const row = gbisRow(item);
		if (row) {
			rows.push(row);
		}
	}
	return finish(rows, items.length);
}

function tagoRow(item: unknown): RegionalPositionRow | null {
	if (!isObj(item)) {
		return null;
	}
	const plate = str(item.vehicleno);
	const seq = num(item.nodeord);
	if (plate === null || seq === null) {
		return null;
	}
	return {
		lat: num(item.gpslati),
		lng: num(item.gpslong),
		plate,
		seq,
		vehId: plate,
	};
}

function parseTago(response: Obj): Parsed {
	const { header } = response;
	if (!isObj(header)) {
		return failed("malformed");
	}
	const code = str(header.resultCode);
	if (code === TAGO_NO_DATA) {
		return failed("no-data");
	}
	if (code !== TAGO_OK) {
		return failed(code === null ? "malformed" : "temporary");
	}
	const { body } = response;
	const items =
		isObj(body) && isObj(body.items) ? toArray(body.items.item) : [];
	const rows: RegionalPositionRow[] = [];
	for (const item of items) {
		const row = tagoRow(item);
		if (row) {
			rows.push(row);
		}
	}
	return finish(rows, items.length);
}

export function parseRegionalPositions(
	source: "gbis" | "tago",
	status: number,
	body: string
): Parsed {
	const byStatus = statusOutcome(status);
	if (byStatus) {
		return failed(byStatus);
	}
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return failed("malformed");
	}
	if (!isObj(json)) {
		return failed("malformed");
	}
	const envelope = json.OpenAPI_ServiceResponse;
	if (isObj(envelope)) {
		const head = envelope.cmmMsgHeader;
		const code = isObj(head) ? str(head.returnReasonCode) : null;
		return failed(code === null ? "malformed" : gatewayOutcome(code));
	}
	if (!isObj(json.response)) {
		return failed("malformed");
	}
	return source === "gbis"
		? parseGbis(json.response)
		: parseTago(json.response);
}

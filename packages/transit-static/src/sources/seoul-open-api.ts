// 서울 열린데이터광장 인증키 API(openapi.seoul.go.kr:8088)는 상류 문서가 안내하는 HTTP(평문) 엔드포인트를 쓴다.
// 테스트가 URL 형태에 의존하므로 상수로 고정한다. (datafile.seoul.go.kr 등 다른 호스트는 HTTPS)
const SEOUL_API_BASE = "http://openapi.seoul.go.kr:8088";

const CODE_OK = "INFO-000";
const CODE_NO_DATA = "INFO-200";
const MASTER_SERVICE = "subwayStationMaster";
const SEARCH_SERVICE = "SearchInfoBySubwayNameService";
const MASTER_PAGE_SIZE = 1000;
const SEARCH_PAGE_SIZE = 100;
const MAX_MASTER_PAGES = 20;

export interface StationMasterRow {
	bldnId: string;
	bldnNm: string;
	lat: number;
	lng: number;
	route: string;
}

export interface StationSearchRow {
	frCode: string;
	lineNum: string;
	stationCd: string;
	stationNm: string;
}

export type SeoulApiResult<T> =
	| { ok: true; rows: T[]; totalCount: number }
	| { ok: false; code: string; message: string };

type RawRow = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readResult(
	value: unknown
): { code: string; message: string } | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const result = value.RESULT;
	if (!isRecord(result) || typeof result.CODE !== "string") {
		return undefined;
	}
	return {
		code: result.CODE,
		message: typeof result.MESSAGE === "string" ? result.MESSAGE : "",
	};
}

export function parseSeoulEnvelope(
	serviceName: string,
	json: unknown
): SeoulApiResult<RawRow> {
	const body = isRecord(json) ? json[serviceName] : undefined;
	const result = readResult(body) ?? readResult(json);
	if (!result) {
		return {
			code: "MALFORMED",
			message: `unexpected response shape for ${serviceName}`,
			ok: false,
		};
	}
	if (result.code === CODE_NO_DATA) {
		return { ok: true, rows: [], totalCount: 0 };
	}
	if (result.code !== CODE_OK || !isRecord(body)) {
		return { code: result.code, message: result.message, ok: false };
	}
	const rows = Array.isArray(body.row) ? (body.row as RawRow[]) : [];
	const total = Number(body.list_total_count);
	return {
		ok: true,
		rows,
		totalCount: Number.isFinite(total) ? total : rows.length,
	};
}

export function seoulApiUrl(
	key: string,
	service: string,
	start: number,
	end: number,
	extraPath?: string
): string {
	const tail = extraPath === undefined ? "" : encodeURIComponent(extraPath);
	return `${SEOUL_API_BASE}/${key}/json/${service}/${start}/${end}/${tail}`;
}

async function requestEnvelope(
	fetchImpl: typeof fetch,
	service: string,
	url: string
): Promise<SeoulApiResult<RawRow>> {
	const response = await fetchImpl(url);
	if (!response.ok) {
		return {
			code: `HTTP-${response.status}`,
			message: `${service} request failed`,
			ok: false,
		};
	}
	return parseSeoulEnvelope(service, await response.json());
}

function str(value: unknown): string {
	return value === null || value === undefined ? "" : String(value).trim();
}

export async function fetchStationMasterRaw(
	key: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeoulApiResult<RawRow>> {
	const rows: RawRow[] = [];
	let start = 1;
	for (let page = 0; page < MAX_MASTER_PAGES; page += 1) {
		const end = start + MASTER_PAGE_SIZE - 1;
		// biome-ignore lint/performance/noAwaitInLoops: pages are fetched sequentially by design
		const result = await requestEnvelope(
			fetchImpl,
			MASTER_SERVICE,
			seoulApiUrl(key, MASTER_SERVICE, start, end, "")
		);
		if (!result.ok) {
			return result;
		}
		rows.push(...result.rows);
		if (end >= result.totalCount || result.rows.length === 0) {
			return { ok: true, rows, totalCount: result.totalCount };
		}
		start = end + 1;
	}
	return {
		code: "TOO_MANY_PAGES",
		message: `${MASTER_SERVICE} exceeded ${MAX_MASTER_PAGES} pages`,
		ok: false,
	};
}

export function normalizeStationMasterRows(
	rawRows: RawRow[]
): SeoulApiResult<StationMasterRow> {
	const rows: StationMasterRow[] = [];
	for (const raw of rawRows) {
		const lat = Number(raw.LAT);
		const lng = Number(raw.LOT);
		if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
			return {
				code: "PARSE",
				message: `invalid LAT/LOT for BLDN_ID ${str(raw.BLDN_ID)}`,
				ok: false,
			};
		}
		rows.push({
			bldnId: str(raw.BLDN_ID),
			bldnNm: str(raw.BLDN_NM),
			lat,
			lng,
			route: str(raw.ROUTE),
		});
	}
	return { ok: true, rows, totalCount: rows.length };
}

export async function fetchStationMaster(
	key: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeoulApiResult<StationMasterRow>> {
	const raw = await fetchStationMasterRaw(key, fetchImpl);
	if (!raw.ok) {
		return raw;
	}
	const normalized = normalizeStationMasterRows(raw.rows);
	return normalized.ok
		? { ...normalized, totalCount: raw.totalCount }
		: normalized;
}

export function fetchStationSearchRaw(
	key: string,
	name: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeoulApiResult<RawRow>> {
	return requestEnvelope(
		fetchImpl,
		SEARCH_SERVICE,
		seoulApiUrl(key, SEARCH_SERVICE, 1, SEARCH_PAGE_SIZE, name)
	);
}

export function normalizeStationSearchRows(
	rawRows: RawRow[]
): StationSearchRow[] {
	return rawRows.map((raw) => ({
		frCode: str(raw.FR_CODE),
		lineNum: str(raw.LINE_NUM),
		stationCd: str(raw.STATION_CD),
		stationNm: str(raw.STATION_NM),
	}));
}

export async function fetchStationSearch(
	key: string,
	name: string,
	fetchImpl: typeof fetch = fetch
): Promise<SeoulApiResult<StationSearchRow>> {
	const result = await fetchStationSearchRaw(key, name, fetchImpl);
	if (!result.ok) {
		return result;
	}
	return {
		ok: true,
		rows: normalizeStationSearchRows(result.rows),
		totalCount: result.totalCount,
	};
}

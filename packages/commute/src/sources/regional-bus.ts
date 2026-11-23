import { z } from "zod";
import type { RouteStopArrival } from "./seoul-bus";

export type RegionalSource = "gbis" | "tago";
export type RegionalFail =
	| "no-data"
	| "temporary"
	| "quota"
	| "auth"
	| "malformed";
export type RegionalResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: RegionalFail };

export interface RegionalStop {
	seq: number;
	stopId: string;
}

export interface RegionalPosition {
	plate: string;
	seq: number;
	vehicleId: string;
}

/** TAGO 도착의 차량 위치와 위치 목록 순번이 이만큼까지 어긋나도 같은 차량으로 본다. */
export const TAGO_MATCH_TOLERANCE = 2;

const GBIS_BASE = "https://apis.data.go.kr/6410000";
const TAGO_BASE = "https://apis.data.go.kr/1613000";
const TAGO_ARRIVAL_ROWS = 20;
const TAGO_LOCATION_ROWS = 200;
const GBIS_NO_DATA_CODE = 4;
const GBIS_OK_CODE = 0;
const TAGO_OK_CODE = "00";
const TAGO_NO_DATA_CODE = "03";
const GATEWAY_QUOTA = "22";
const GATEWAY_AUTH = new Set(["20", "30", "31", "32", "33"]);
const UNKNOWN_POSITION_PREFIX = "tago-pos:";

const fail = (reason: RegionalFail): { ok: false; reason: RegionalFail } => ({
	ok: false,
	reason,
});

function query(params: Record<string, string | number>): string {
	return Object.entries(params)
		.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
		.join("&");
}

export function gbisArrivalUrl(
	key: string,
	routeId: string,
	stop: RegionalStop
): string {
	return `${GBIS_BASE}/busarrivalservice/v2/getBusArrivalItemv2?${query({
		format: "json",
		routeId,
		serviceKey: key,
		staOrder: stop.seq,
		stationId: stop.stopId,
	})}`;
}

export function gbisLocationUrl(key: string, routeId: string): string {
	return `${GBIS_BASE}/buslocationservice/v2/getBusLocationListv2?${query({
		format: "json",
		routeId,
		serviceKey: key,
	})}`;
}

export function tagoArrivalUrl(
	key: string,
	cityCode: string,
	routeId: string,
	stop: RegionalStop
): string {
	return `${TAGO_BASE}/ArvlInfoInqireService/getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList?${query(
		{
			_type: "json",
			cityCode,
			nodeId: stop.stopId,
			numOfRows: TAGO_ARRIVAL_ROWS,
			routeId,
			serviceKey: key,
		}
	)}`;
}

export function tagoLocationUrl(
	key: string,
	cityCode: string,
	routeId: string
): string {
	return `${TAGO_BASE}/BusLcInfoInqireService/getRouteAcctoBusLcList?${query({
		_type: "json",
		cityCode,
		numOfRows: TAGO_LOCATION_ROWS,
		routeId,
		serviceKey: key,
	})}`;
}

const gatewaySchema = z.object({
	OpenAPI_ServiceResponse: z.object({
		cmmMsgHeader: z.object({ returnReasonCode: z.coerce.string() }),
	}),
});

/** 게이트웨이 오류 봉투면 실패 종류를, 아니면 null을 돌려준다. 04를 포함한 그 밖의 코드는 일시 오류다. */
function gatewayFailure(json: unknown): RegionalFail | null {
	const parsed = gatewaySchema.safeParse(json);
	if (!parsed.success) {
		return null;
	}
	const code =
		parsed.data.OpenAPI_ServiceResponse.cmmMsgHeader.returnReasonCode.trim();
	if (code === GATEWAY_QUOTA) {
		return "quota";
	}
	return GATEWAY_AUTH.has(code) ? "auth" : "temporary";
}

const num = z.coerce.number();
const text = z.coerce.string();

// ---- GBIS ----

const gbisEnvelope = z.object({
	response: z.object({
		msgBody: z.record(z.string(), z.unknown()).nullish(),
		msgHeader: z.object({ resultCode: num }),
	}),
});

function gbisBody(
	json: unknown
): RegionalResult<Record<string, unknown> | null> {
	const gateway = gatewayFailure(json);
	if (gateway) {
		return fail(gateway);
	}
	const parsed = gbisEnvelope.safeParse(json);
	if (!parsed.success) {
		return fail("malformed");
	}
	const { resultCode } = parsed.data.response.msgHeader;
	if (resultCode === GBIS_NO_DATA_CODE) {
		return fail("no-data");
	}
	if (resultCode !== GBIS_OK_CODE) {
		return fail("malformed");
	}
	return { ok: true, value: parsed.data.response.msgBody ?? null };
}

const optionalNum = z.coerce.number().nullish();
const gbisArrivalItem = z.object({
	locationNo1: optionalNum,
	locationNo2: optionalNum,
	plateNo1: z.string().nullish(),
	plateNo2: z.string().nullish(),
	predictTimeSec1: optionalNum,
	predictTimeSec2: optionalNum,
	vehId1: optionalNum,
	vehId2: optionalNum,
});

type GbisArrivalItem = z.infer<typeof gbisArrivalItem>;
type ArrivalVehicle = RouteStopArrival["vehicles"][number];

function gbisVehicle(
	item: GbisArrivalItem,
	n: 1 | 2,
	staOrder: number
): ArrivalVehicle | null {
	const vehId = item[`vehId${n}`];
	const eta = item[`predictTimeSec${n}`];
	const location = item[`locationNo${n}`];
	if (!vehId || eta === null || eta === undefined) {
		return null;
	}
	if (location === null || location === undefined) {
		return null;
	}
	return {
		etaSec: eta,
		isArrived: location === 0,
		lastOfDay: false,
		plate: (item[`plateNo${n}`] ?? "").trim(),
		seqNow: staOrder - location,
		vehicleId: String(vehId),
	};
}

export function parseGbisArrival(
	json: unknown,
	stop: RegionalStop,
	fetchedAt: number
): RegionalResult<RouteStopArrival> {
	const body = gbisBody(json);
	if (!body.ok) {
		return body;
	}
	const raw = body.value?.busArrivalItem;
	const first = Array.isArray(raw) ? raw[0] : raw;
	const parsed = gbisArrivalItem.safeParse(first);
	if (!parsed.success) {
		return fail(first === undefined ? "no-data" : "malformed");
	}
	const vehicles = [1, 2]
		.map((n) => gbisVehicle(parsed.data, n as 1 | 2, stop.seq))
		.filter((vehicle): vehicle is ArrivalVehicle => vehicle !== null)
		.sort((a, b) => a.etaSec - b.etaSec);
	return {
		ok: true,
		value: {
			headwayMin: null,
			madeAt: fetchedAt,
			seq: stop.seq,
			stopId: stop.stopId,
			vehicles,
		},
	};
}

const gbisLocationItem = z.object({
	plateNo: z.string().nullish(),
	stationSeq: num,
	vehId: text,
});

export function parseGbisLocations(
	json: unknown
): RegionalResult<RegionalPosition[]> {
	const body = gbisBody(json);
	if (!body.ok) {
		return body;
	}
	const raw = body.value?.busLocationList;
	if (raw === undefined || raw === null) {
		return fail("no-data");
	}
	const list = Array.isArray(raw) ? raw : [raw];
	const positions: RegionalPosition[] = [];
	for (const entry of list) {
		const parsed = gbisLocationItem.safeParse(entry);
		if (!parsed.success) {
			return fail("malformed");
		}
		positions.push({
			plate: (parsed.data.plateNo ?? "").trim(),
			seq: parsed.data.stationSeq,
			vehicleId: parsed.data.vehId.trim(),
		});
	}
	return { ok: true, value: positions };
}

// ---- TAGO ----

const tagoEnvelope = z.object({
	response: z.object({
		body: z
			.object({ items: z.union([z.string(), z.object({}).passthrough()]) })
			.nullish(),
		header: z.object({ resultCode: text }),
	}),
});

function tagoItems(json: unknown): RegionalResult<unknown[]> {
	const gateway = gatewayFailure(json);
	if (gateway) {
		return fail(gateway);
	}
	const parsed = tagoEnvelope.safeParse(json);
	if (!parsed.success) {
		return fail("malformed");
	}
	const { header, body } = parsed.data.response;
	if (header.resultCode === TAGO_NO_DATA_CODE) {
		return fail("no-data");
	}
	if (header.resultCode !== TAGO_OK_CODE) {
		return fail("malformed");
	}
	const items = body?.items;
	if (items === undefined || typeof items === "string") {
		return fail("no-data");
	}
	const { item } = items as { item?: unknown };
	if (item === undefined || item === null) {
		return fail("no-data");
	}
	return { ok: true, value: Array.isArray(item) ? item : [item] };
}

const tagoArrivalItem = z.object({
	arrprevstationcnt: num,
	arrtime: num,
});

export function parseTagoArrival(
	json: unknown,
	stop: RegionalStop,
	fetchedAt: number
): RegionalResult<RouteStopArrival> {
	const items = tagoItems(json);
	if (!items.ok) {
		return items;
	}
	const vehicles: ArrivalVehicle[] = [];
	for (const entry of items.value) {
		const parsed = tagoArrivalItem.safeParse(entry);
		if (!parsed.success) {
			return fail("malformed");
		}
		vehicles.push({
			etaSec: parsed.data.arrtime,
			isArrived: parsed.data.arrprevstationcnt === 0,
			lastOfDay: false,
			plate: "",
			seqNow: stop.seq - parsed.data.arrprevstationcnt,
			vehicleId: "",
		});
	}
	vehicles.sort((a, b) => a.etaSec - b.etaSec);
	return {
		ok: true,
		value: {
			headwayMin: null,
			madeAt: fetchedAt,
			seq: stop.seq,
			stopId: stop.stopId,
			vehicles,
		},
	};
}

const tagoLocationItem = z.object({
	nodeord: num,
	vehicleno: text,
});

export function parseTagoLocations(
	json: unknown
): RegionalResult<RegionalPosition[]> {
	const items = tagoItems(json);
	if (!items.ok) {
		return items;
	}
	const positions: RegionalPosition[] = [];
	for (const entry of items.value) {
		const parsed = tagoLocationItem.safeParse(entry);
		if (!parsed.success) {
			return fail("malformed");
		}
		const plate = parsed.data.vehicleno.trim();
		positions.push({ plate, seq: parsed.data.nodeord, vehicleId: plate });
	}
	return { ok: true, value: positions };
}

/**
 * TAGO 도착의 차량에 위치 목록의 차량 번호를 붙인다. 가까운 순서대로,
 * `seqNow` 이하이면서 차이가 `TAGO_MATCH_TOLERANCE` 이하인 가장 가까운 차량을 고르고
 * 한 차량은 한 번만 쓴다. 맞는 차량이 없으면 `tago-pos:<seqNow>`다.
 */
export function matchTagoVehicles(
	arrival: RouteStopArrival,
	positions: readonly RegionalPosition[]
): RouteStopArrival {
	const used = new Set<string>();
	const vehicles = arrival.vehicles.map((vehicle) => {
		let best: RegionalPosition | null = null;
		for (const position of positions) {
			const gap = vehicle.seqNow - position.seq;
			if (
				used.has(position.vehicleId) ||
				gap < 0 ||
				gap > TAGO_MATCH_TOLERANCE
			) {
				continue;
			}
			if (best === null || position.seq > best.seq) {
				best = position;
			}
		}
		if (best === null) {
			return {
				...vehicle,
				vehicleId: `${UNKNOWN_POSITION_PREFIX}${vehicle.seqNow}`,
			};
		}
		used.add(best.vehicleId);
		return { ...vehicle, plate: best.plate, vehicleId: best.vehicleId };
	});
	return { ...arrival, vehicles };
}

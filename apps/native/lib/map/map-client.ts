import type { Route } from "@Betro/commute/plan";
import { z } from "zod";
import type { RefFailure, RefResult } from "@/lib/ref/ref-client";
import type { ServerClient, ServerResponse } from "@/lib/server/api-client";

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_NOT_MODIFIED = 304;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const NETWORK_ERROR_STATUS = 0;

const lngLatSchema = z.tuple([z.number(), z.number()]);

const busMapSchema = z.object({
	batchId: z.number(),
	line: z.string(),
	shape: z.array(lngLatSchema),
	stops: z.array(
		z.object({
			arsId: z.string().nullable(),
			lat: z.number(),
			lng: z.number(),
			name: z.string(),
			seq: z.number(),
			stop: z.string(),
		})
	),
});

const subwayMapSchema = z.object({
	batchId: z.number(),
	branches: z.array(
		z.object({
			branchKey: z.string(),
			direction: z.enum(["up", "down"]),
			shape: z.array(lngLatSchema),
			stations: z.array(
				z.object({
					lat: z.number(),
					lng: z.number(),
					name: z.string(),
					nextRunSec: z.number().nullable(),
					offsetM: z.number(),
					seq: z.number(),
					stop: z.string(),
				})
			),
		})
	),
	line: z.string(),
});

const subwayStationPointSchema = z.object({
	lat: z.number(),
	line: z.string(),
	lng: z.number(),
	name: z.string(),
	stop: z.string(),
});

const arrivalMethodSchema = z.string();

const routeViewLegSchema = z.object({
	approaching: z.array(
		z.object({
			etaAt: z.number().nullable(),
			method: arrivalMethodSchema.nullable(),
			stopsAway: z.number().nullable(),
			vehicleId: z.string(),
		})
	),
	boardEtaAt: z.number().nullable(),
	etaState: z.enum(["live", "estimated"]),
	method: arrivalMethodSchema.nullable(),
	positionState: z.enum(["live", "stale", "none"]),
	vehicleId: z.string().nullable(),
});

const routeViewSchema = z.object({
	destinationEtaAt: z.number().nullable(),
	legs: z.array(routeViewLegSchema),
});

/** 스냅샷 차량 중 지도에 필요한 필드만 읽는다. 나머지 키는 버린다. */
const busVehicleSchema = z.object({
	lastSeenAt: z.number(),
	lat: z.number(),
	lng: z.number(),
	observedAt: z.number(),
	routeId: z.string(),
	sectOrd: z.number(),
	vehId: z.string(),
});

const subwayVehicleSchema = z.object({
	direction: z.enum(["up", "down"]),
	lastSeenAt: z.number(),
	lineKey: z.string(),
	observedAt: z.number(),
	rawTrainNo: z.string(),
	stationDistanceM: z.number().nullable(),
	statnId: z.string().nullable(),
	status: z.enum(["approach", "arrive", "depart", "prev-depart"]).nullable(),
});

const busSnapshotSchema = z.object({
	generatedAt: z.number(),
	staleRoutes: z.record(z.string(), z.number()),
	staleSince: z.number().nullable(),
	vehicles: z.array(busVehicleSchema),
});

const subwaySnapshotSchema = z.object({
	generatedAt: z.number(),
	staleSince: z.number().nullable(),
	vehicles: z.array(subwayVehicleSchema),
});

export type BusMap = z.infer<typeof busMapSchema>;
export type SubwayMap = z.infer<typeof subwayMapSchema>;
export type SubwayStationPoint = z.infer<typeof subwayStationPointSchema>;
export type RouteView = z.infer<typeof routeViewSchema>;
export type RouteViewLeg = z.infer<typeof routeViewLegSchema>;
export type BusSnapshotVehicle = z.infer<typeof busVehicleSchema>;
export type SubwaySnapshotVehicle = z.infer<typeof subwayVehicleSchema>;
export type BusSnapshot = z.infer<typeof busSnapshotSchema>;
export type SubwaySnapshot = z.infer<typeof subwaySnapshotSchema>;

function statusFailure(status: number): RefFailure {
	if (status === NETWORK_ERROR_STATUS) {
		return "offline";
	}
	// 401은 설치를 서버가 모르는 상태다. 지도에서는 서버를 쓸 수 없는 것과 같게 본다.
	if (status === HTTP_UNAVAILABLE || status === HTTP_UNAUTHORIZED) {
		return "unavailable";
	}
	if (status === HTTP_NOT_FOUND) {
		return "not-found";
	}
	return "invalid";
}

function read<S extends z.ZodType>(
	response: ServerResponse,
	schema: S
): RefResult<z.infer<S>> {
	if (response.status !== HTTP_OK) {
		return { ok: false, reason: statusFailure(response.status) };
	}
	const parsed = schema.safeParse(response.json);
	if (!parsed.success) {
		return { ok: false, reason: "invalid" };
	}
	return { ok: true, value: parsed.data };
}

export async function fetchBusMap(
	client: ServerClient,
	busRouteId: string
): Promise<RefResult<BusMap>> {
	const response = await client.request(
		"GET",
		`/v1/ref/map/bus/${encodeURIComponent(busRouteId)}`
	);
	return read(response, busMapSchema);
}

export async function fetchSubwayMap(
	client: ServerClient,
	lineKey: string
): Promise<RefResult<SubwayMap>> {
	const response = await client.request(
		"GET",
		`/v1/ref/map/subway/${encodeURIComponent(lineKey)}`
	);
	return read(response, subwayMapSchema);
}

export async function fetchSubwayStations(
	client: ServerClient
): Promise<RefResult<SubwayStationPoint[]>> {
	const response = await client.request("GET", "/v1/ref/map/subway-stations");
	const result = read(
		response,
		z.object({ stations: z.array(subwayStationPointSchema) })
	);
	return result.ok ? { ok: true, value: result.value.stations } : result;
}

/**
 * 스냅샷을 받는다. 앞서 받은 ETag가 있으면 `If-None-Match`로 보내고, 304는 `"not-modified"`다.
 * 200인데 ETag가 없으면 다음 요청에 쓸 수 없어 `invalid`로 본다.
 */
export async function fetchSnapshot(
	client: ServerClient,
	kind: "bus" | "subway",
	etag: string | null
): Promise<
	RefResult<
		{ etag: string; snapshot: BusSnapshot | SubwaySnapshot } | "not-modified"
	>
> {
	const response = await client.request(
		"GET",
		`/v1/snapshot/${kind}`,
		undefined,
		etag === null ? undefined : { headers: { "If-None-Match": etag } }
	);
	if (response.status === HTTP_NOT_MODIFIED) {
		return { ok: true, value: "not-modified" };
	}
	const result = read(
		response,
		kind === "bus" ? busSnapshotSchema : subwaySnapshotSchema
	);
	if (!result.ok) {
		return result;
	}
	if (!response.etag) {
		return { ok: false, reason: "invalid" };
	}
	return { ok: true, value: { etag: response.etag, snapshot: result.value } };
}

/** 지도에 보이는 동안 관측할 버스 노선을 알린다. 노선 ref만 보내고 위치는 보내지 않는다. */
export async function postWatch(
	client: ServerClient,
	busRoutes: string[]
): Promise<RefResult<null>> {
	const response = await client.request("POST", "/v1/map/watch", {
		busRoutes,
	});
	if (response.status === HTTP_NO_CONTENT) {
		return { ok: true, value: null };
	}
	return { ok: false, reason: statusFailure(response.status) };
}

export async function postRouteView(
	client: ServerClient,
	route: Route
): Promise<RefResult<RouteView>> {
	const response = await client.request("POST", "/v1/map/route-view", {
		route,
	});
	return read(response, routeViewSchema);
}

/** 참조 데이터를 ETag와 함께 둘 저장소. expo-sqlite kv-store가 이 모양이다. */
export interface MapKvStore {
	getItem: (key: string) => Promise<string | null>;
	setItem: (key: string, value: string) => Promise<void>;
}

export interface MapRefCache {
	get: <T>(key: string) => Promise<{ etag: string; value: T } | null>;
	set: <T>(key: string, etag: string, value: T) => Promise<void>;
}

const CACHE_KEY_PREFIX = "betro.mapRef.";

const cachedEntrySchema = z.object({ etag: z.string(), value: z.unknown() });

/**
 * 버전이 바뀔 때만 다시 받도록 참조 데이터를 ETag와 같이 저장한다(지도 설계 4.2).
 * 읽기 실패나 깨진 값은 없는 것으로 보고, 쓰기 실패는 캐시만 못 쓰는 것이라 삼킨다.
 */
export function createMapRefCache(store: MapKvStore): MapRefCache {
	return {
		async get<T>(key: string) {
			try {
				const raw = await store.getItem(`${CACHE_KEY_PREFIX}${key}`);
				if (raw === null) {
					return null;
				}
				const parsed = cachedEntrySchema.safeParse(JSON.parse(raw));
				if (!parsed.success) {
					return null;
				}
				return { etag: parsed.data.etag, value: parsed.data.value as T };
			} catch {
				return null;
			}
		},
		async set<T>(key: string, etag: string, value: T) {
			try {
				await store.setItem(
					`${CACHE_KEY_PREFIX}${key}`,
					JSON.stringify({ etag, value })
				);
			} catch {
				// 캐시를 못 써도 다음에 다시 받으면 된다.
			}
		},
	};
}

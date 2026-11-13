import { z } from "zod";
import type { ServerClient, ServerResponse } from "@/lib/server/api-client";

export type RefFailure = "offline" | "unavailable" | "not-found" | "invalid";
export type RefResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: RefFailure };

/** 조회 데이터는 하루에 한 번 바뀐다. 한 번 받은 것은 등록하는 동안 다시 받지 않는다. */
export const REF_STALE_MS = 10 * 60 * 1000;

/**
 * `RefResult`를 담는 쿼리의 `staleTime`. 조회 함수는 실패해도 throw하지 않으므로, 실패(오프라인·503·시간 초과)가
 * 성공처럼 10분 동안 캐시되지 않게 성공만 신선하게 둔다.
 */
export function refStaleTime(query: {
	state: { data?: { ok: boolean } | undefined };
}): number {
	return query.state.data?.ok ? REF_STALE_MS : 0;
}

const regionSchema = z.enum(["seoul", "gyeonggi", "incheon"]);

const busRouteMatchSchema = z.object({
	line: z.string(),
	name: z.string(),
	region: regionSchema,
	routeType: z.string(),
	shortName: z.string(),
});
const busStopSchema = z.object({
	arsId: z.string().nullable(),
	directionName: z.string().nullable(),
	name: z.string(),
	seq: z.number(),
	stop: z.string(),
});
const busRouteStopsSchema = z.object({
	line: z.string(),
	name: z.string(),
	region: regionSchema,
	shortName: z.string(),
	stops: z.array(busStopSchema),
});
const subwayLineSchema = z.object({ line: z.string(), name: z.string() });
const subwayBranchSchema = z.object({
	branchKey: z.string(),
	stations: z.array(z.object({ name: z.string(), stop: z.string() })),
});
const directionSchema = z.object({
	direction: z.enum(["up", "down"]),
	stops: z.number(),
});
const notDirectSchema = z.object({ error: z.literal("not-direct") });

export type BusRouteMatch = z.infer<typeof busRouteMatchSchema>;
export type BusStop = z.infer<typeof busStopSchema>;
export type BusRouteStops = z.infer<typeof busRouteStopsSchema>;
export type SubwayLine = z.infer<typeof subwayLineSchema>;
export type SubwayBranch = z.infer<typeof subwayBranchSchema>;
export type SubwayDirection = z.infer<typeof directionSchema>;

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const NETWORK_ERROR_STATUS = 0;

function statusFailure(status: number): RefFailure {
	if (status === NETWORK_ERROR_STATUS) {
		return "offline";
	}
	if (status === HTTP_UNAVAILABLE) {
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

function pick<T, K extends string>(
	result: RefResult<Record<K, T>>,
	key: K
): RefResult<T> {
	return result.ok ? { ok: true, value: result.value[key] } : result;
}

export async function searchBusRoutes(
	client: ServerClient,
	q: string
): Promise<RefResult<BusRouteMatch[]>> {
	const query = q.trim();
	if (query === "") {
		return { ok: true, value: [] };
	}
	const response = await client.request(
		"GET",
		`/v1/ref/bus/routes?q=${encodeURIComponent(query)}`
	);
	return pick(
		read(response, z.object({ routes: z.array(busRouteMatchSchema) })),
		"routes"
	);
}

export async function busRouteStops(
	client: ServerClient,
	line: string
): Promise<RefResult<BusRouteStops>> {
	const response = await client.request(
		"GET",
		`/v1/ref/bus/routes/${encodeURIComponent(line)}/stops`
	);
	return read(response, busRouteStopsSchema);
}

export async function subwayLines(
	client: ServerClient
): Promise<RefResult<SubwayLine[]>> {
	const response = await client.request("GET", "/v1/ref/subway/lines");
	return pick(
		read(response, z.object({ lines: z.array(subwayLineSchema) })),
		"lines"
	);
}

export async function subwayStations(
	client: ServerClient,
	line: string
): Promise<RefResult<SubwayBranch[]>> {
	const response = await client.request(
		"GET",
		`/v1/ref/subway/lines/${encodeURIComponent(line)}/stations`
	);
	return pick(
		read(response, z.object({ branches: z.array(subwayBranchSchema) })),
		"branches"
	);
}

export async function subwayDirection(
	client: ServerClient,
	line: string,
	from: string,
	to: string
): Promise<RefResult<SubwayDirection> | { ok: false; reason: "not-direct" }> {
	const response = await client.request(
		"GET",
		`/v1/ref/subway/direction?line=${encodeURIComponent(line)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
	);
	if (
		response.status === HTTP_NOT_FOUND &&
		notDirectSchema.safeParse(response.json).success
	) {
		return { ok: false, reason: "not-direct" };
	}
	return read(response, directionSchema);
}

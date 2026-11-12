import type { ReferenceBatchKind } from "@Betro/db/schema/transit";
import {
	FCM_PROJECT_ID,
	fcmAccessTokenRequest,
	fcmSendRequest,
} from "@Betro/realtime/alerts";
import type { MetricsBucket } from "@Betro/realtime/metrics";
import {
	type BusReference,
	type BusRouteRef,
	type BusSegmentRef,
	buildSubwayReference,
	type SubwayReference,
	type SubwayReferenceRows,
} from "@Betro/realtime/reference";
import {
	type CollectorConfig,
	devConfig,
	type EnvLike,
	prodConfig,
} from "@Betro/realtime/schedule";
import type {
	D1Database,
	R2Bucket,
	SqlStorage,
} from "@cloudflare/workers-types";
import arrivalAllSample from "../../../../packages/realtime/src/__fixtures__/arrival-all-sample.json";
import bus150Sample from "../../../../packages/realtime/src/__fixtures__/bus-150.json";
import bus6411Sample from "../../../../packages/realtime/src/__fixtures__/bus-6411.json";
import positionLine2Sample from "../../../../packages/realtime/src/__fixtures__/position-line2.json";
import positionLine7Sample from "../../../../packages/realtime/src/__fixtures__/position-line7.json";
import type { Env } from "../worker-env";
import type {
	BlobStore,
	Notifier,
	ReferenceSource,
	StateStore,
	Upstream,
	UpstreamResponse,
} from "./ports";
import { errorText } from "./util";

/** 상류 요청 하나의 제한 시간(본문 읽기 포함). */
export const UPSTREAM_TIMEOUT_MS = 10_000;
/** FCM 요청 제한 시간. */
const FCM_TIMEOUT_MS = 10_000;
/** OAuth 액세스 토큰(유효 1시간)을 다시 받기 전까지 쓰는 시간. */
export const FCM_TOKEN_CACHE_MS = 50 * 60_000;
/** D1 바인딩 변수 한도(100) 안에서 `IN (...)`에 넣는 개수. */
const D1_IN_CHUNK = 50;

const REFERENCE_KINDS: readonly ReferenceBatchKind[] = [
	"station_crosswalk",
	"track",
	"timetable",
	"bus_route",
];

type Log = (line: string) => void;

function attempt<T>(fn: () => T): Promise<T> {
	try {
		return Promise.resolve(fn());
	} catch (error) {
		return Promise.reject(error);
	}
}

// ---------------------------------------------------------------------------
// DO SQLite

/**
 * DO SQLite 저장소. `kv`에는 JSON 값을, `metrics_5m`에는 5분 지표를 (bucket_start, source)로 둔다.
 * 생성자에서 테이블을 만든다(이미 있으면 그대로).
 */
export class SqlStateStore implements StateStore {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS metrics_5m (bucket_start INTEGER NOT NULL, source TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (bucket_start, source))"
		);
	}

	get<T>(key: string): Promise<T | undefined> {
		return attempt(() => {
			const [row] = this.#sql
				.exec<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)
				.toArray();
			return row === undefined ? undefined : (JSON.parse(row.value) as T);
		});
	}

	put(key: string, value: unknown): Promise<void> {
		return attempt(() => {
			// undefined는 JSON으로 쓸 수 없으므로 키를 지운다.
			const text: string | undefined = JSON.stringify(value);
			if (value === undefined || text === undefined) {
				this.#sql.exec("DELETE FROM kv WHERE key = ?", key);
				return;
			}
			this.#sql.exec(
				"INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
				key,
				text
			);
		});
	}

	putMetrics(bucket: MetricsBucket): Promise<void> {
		return attempt(() => {
			this.#sql.exec(
				"INSERT INTO metrics_5m (bucket_start, source, value) VALUES (?, ?, ?) ON CONFLICT (bucket_start, source) DO UPDATE SET value = excluded.value",
				bucket.bucketStart,
				bucket.source,
				JSON.stringify(bucket)
			);
		});
	}

	metricsSince(t: number): Promise<MetricsBucket[]> {
		return attempt(() =>
			this.#sql
				.exec<{ value: string }>(
					"SELECT value FROM metrics_5m WHERE bucket_start >= ? ORDER BY bucket_start, source",
					t
				)
				.toArray()
				.map((row) => JSON.parse(row.value) as MetricsBucket)
		);
	}

	pruneMetrics(before: number): Promise<void> {
		return attempt(() => {
			this.#sql.exec("DELETE FROM metrics_5m WHERE bucket_start < ?", before);
		});
	}
}

// ---------------------------------------------------------------------------
// R2

export class R2BlobStore implements BlobStore {
	readonly #bucket: R2Bucket;

	constructor(bucket: R2Bucket) {
		this.#bucket = bucket;
	}

	async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
		await this.#bucket.put(key, body, { httpMetadata: { contentType } });
	}
}

// ---------------------------------------------------------------------------
// D1 참조

interface BusRouteRow {
	id: number;
	lengthM: number | null;
	routeId: string;
}

interface BusSegmentRow {
	busRouteId: number;
	endM: number;
	fromSeq: number;
	startM: number;
}

interface BusShapeRow {
	busRouteId: number;
	coords: string;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

const placeholders = (count: number): string =>
	Array.from({ length: count }, () => "?").join(", ");

const isLngLat = (value: unknown): value is [number, number] =>
	Array.isArray(value) &&
	value.length === 2 &&
	typeof value[0] === "number" &&
	typeof value[1] === "number";

function parseCoords(text: string): [number, number][] | undefined {
	try {
		const value: unknown = JSON.parse(text);
		if (Array.isArray(value) && value.every(isLngLat)) {
			return value;
		}
	} catch {
		// 깨진 모양은 투영 없이 쓴다.
	}
}

/**
 * D1(`betro`)의 현재 참조 배치. 지하철은 대응표, 선로 위 역(`track_station` ⋈ `track_shape`),
 * 시간표 trip만 읽는다(정차 시각 `timetable_stop_time`은 읽지 않는다). 버스는 요청한 노선의
 * 구간과, `withShapes`일 때 모양 좌표를 읽는다.
 * 현재 배치가 없는 kind는 0으로 돌려준다(그 kind의 행은 비어 있다).
 */
export class D1ReferenceSource implements ReferenceSource {
	readonly #db: D1Database;

	constructor(db: D1Database) {
		this.#db = db;
	}

	async currentBatchIds(): Promise<Record<ReferenceBatchKind, number>> {
		const { results } = await this.#db
			.prepare(
				"SELECT kind, MAX(id) AS id FROM reference_batch WHERE is_current = 1 GROUP BY kind"
			)
			.all<{ id: number; kind: string }>();
		const ids: Record<ReferenceBatchKind, number> = {
			bus_route: 0,
			station_crosswalk: 0,
			timetable: 0,
			track: 0,
		};
		for (const kind of REFERENCE_KINDS) {
			const row = results.find((r) => r.kind === kind);
			if (row) {
				ids[kind] = row.id;
			}
		}
		return ids;
	}

	async loadSubway(): Promise<SubwayReference> {
		const ids = await this.currentBatchIds();
		const [crosswalk, trackStations, trips] = await Promise.all([
			this.#db
				.prepare(
					"SELECT statn_id AS statnId, line_key AS lineKey FROM station_crosswalk WHERE batch_id = ?"
				)
				.bind(ids.station_crosswalk)
				.all<SubwayReferenceRows["crosswalk"][number]>(),
			this.#db
				.prepare(
					`SELECT ts.statn_id AS statnId, ts.seq AS seq, ts.distance_m AS distanceM,
					        ts.track_shape_id AS trackShapeId, sh.line_key AS lineKey,
					        sh.direction AS direction, sh.branch_key AS branchKey
					   FROM track_station ts JOIN track_shape sh ON sh.id = ts.track_shape_id
					  WHERE sh.batch_id = ?`
				)
				.bind(ids.track)
				.all<SubwayReferenceRows["trackStations"][number]>(),
			this.#db
				.prepare(
					`SELECT id, line_key AS lineKey, service_day AS serviceDay, direction,
					        train_no AS trainNo, express, origin_statn_id AS originStatnId,
					        destination_statn_id AS destinationStatnId
					   FROM timetable_trip WHERE batch_id = ?`
				)
				.bind(ids.timetable)
				.all<SubwayReferenceRows["trips"][number]>(),
		]);
		return buildSubwayReference({
			batchIds: {
				crosswalk: ids.station_crosswalk,
				timetable: ids.timetable,
				track: ids.track,
			},
			crosswalk: crosswalk.results,
			trackStations: trackStations.results,
			trips: trips.results,
		});
	}

	async loadBus(
		routeIds: string[],
		withShapes: boolean
	): Promise<BusReference> {
		const { bus_route: batchId } = await this.currentBatchIds();
		const routeRows = (
			await Promise.all(
				chunks(routeIds, D1_IN_CHUNK).map(async (part) => {
					const { results } = await this.#db
						.prepare(
							`SELECT r.id AS id, r.route_id AS routeId, s.length_m AS lengthM
							   FROM bus_route r LEFT JOIN bus_route_shape s ON s.bus_route_id = r.id
							  WHERE r.batch_id = ? AND r.route_id IN (${placeholders(part.length)})`
						)
						.bind(batchId, ...part)
						.all<BusRouteRow>();
					return results;
				})
			)
		).flat();
		const internalIds = routeRows.map((row) => row.id);
		const [segments, shapes] = await Promise.all([
			this.#selectByRoute<BusSegmentRow>(
				"SELECT bus_route_id AS busRouteId, from_seq AS fromSeq, start_m AS startM, end_m AS endM FROM bus_route_segment WHERE bus_route_id IN",
				internalIds
			),
			withShapes
				? this.#selectByRoute<BusShapeRow>(
						"SELECT bus_route_id AS busRouteId, coords FROM bus_route_shape WHERE bus_route_id IN",
						internalIds
					)
				: Promise.resolve([]),
		]);
		return { batchId, routes: assembleBusRoutes(routeRows, segments, shapes) };
	}

	/**
	 * `prod` 설정용: 현재 버스 배치에서 지도용 상시 관측 대상인 노선 ID.
	 * 인천(7)·경기(8) 노선은 출퇴근 세션에서만 관측하므로 뺀다(스펙 3장 "버스 범위",
	 * transit-static bus/scope.ts의 REGIONAL_ROUTE_TYPES·isMapObservedRouteType과 같은 규칙).
	 */
	async currentBusRouteIds(): Promise<string[]> {
		const { bus_route: batchId } = await this.currentBatchIds();
		const { results } = await this.#db
			.prepare(
				"SELECT route_id AS routeId FROM bus_route WHERE batch_id = ? AND route_type NOT IN ('7', '8') ORDER BY route_id"
			)
			.bind(batchId)
			.all<{ routeId: string }>();
		return results.map((row) => row.routeId);
	}

	async #selectByRoute<T>(
		prefix: string,
		ids: readonly number[]
	): Promise<T[]> {
		const parts = await Promise.all(
			chunks(ids, D1_IN_CHUNK).map(async (part) => {
				const { results } = await this.#db
					.prepare(`${prefix} (${placeholders(part.length)})`)
					.bind(...part)
					.all<T>();
				return results;
			})
		);
		return parts.flat();
	}
}

function assembleBusRoutes(
	routeRows: readonly BusRouteRow[],
	segments: readonly BusSegmentRow[],
	shapes: readonly BusShapeRow[]
): Map<string, BusRouteRef> {
	const segmentsByRoute = new Map<number, Map<number, BusSegmentRef>>();
	for (const row of segments) {
		let bySeq = segmentsByRoute.get(row.busRouteId);
		if (!bySeq) {
			bySeq = new Map();
			segmentsByRoute.set(row.busRouteId, bySeq);
		}
		bySeq.set(row.fromSeq, {
			endM: row.endM,
			fromSeq: row.fromSeq,
			startM: row.startM,
		});
	}
	const coordsByRoute = new Map<number, [number, number][]>();
	for (const row of shapes) {
		const coords = parseCoords(row.coords);
		if (coords) {
			coordsByRoute.set(row.busRouteId, coords);
		}
	}
	const routes = new Map<string, BusRouteRef>();
	for (const row of routeRows) {
		const segmentsBySeq = segmentsByRoute.get(row.id) ?? new Map();
		let lastEndM = 0;
		for (const segment of segmentsBySeq.values()) {
			lastEndM = Math.max(lastEndM, segment.endM);
		}
		const route: BusRouteRef = {
			lengthM: row.lengthM ?? lastEndM,
			routeId: row.routeId,
			segmentsBySeq,
		};
		const coords = coordsByRoute.get(row.id);
		if (coords) {
			route.coords = coords;
		}
		routes.set(row.routeId, route);
	}
	return routes;
}

// ---------------------------------------------------------------------------
// 상류

/** 실제 상류. HTTP 오류도 응답으로 돌려주고, 연결 실패·시간 초과는 `status: null`. 던지지 않는다. */
export const liveUpstream: Upstream = {
	async fetch(url: string): Promise<UpstreamResponse> {
		let response: Response;
		try {
			response = await globalThis.fetch(url, {
				signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
			});
		} catch (error) {
			return { body: "", error: errorText(error), status: null };
		}
		try {
			return { body: await response.text(), status: response.status };
		} catch (error) {
			return { body: "", error: errorText(error), status: response.status };
		}
	},
};

const ALL_URL = /\/realtimeStationArrival\/ALL(?:$|[/?])/;
const POSITION_URL = /\/realtimePosition\/\d+\/\d+\/([^/?]+)/;
const BUS_ROUTE_PARAM = /[?&]busRouteId=([^&]+)/;

const NO_SUBWAY_DATA = JSON.stringify({
	errorMessage: {
		code: "INFO-200",
		message: "해당하는 데이터가 없습니다.",
		status: 200,
	},
});
const NO_BUS_DATA = JSON.stringify({
	msgBody: { itemList: null },
	msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." },
});

const FIXTURE_BODIES = {
	all: JSON.stringify(arrivalAllSample),
	bus: new Map<string, string>([
		["100100029", JSON.stringify(bus150Sample)],
		["100100290", JSON.stringify(bus6411Sample)],
	]),
	position: new Map<string, string>([
		["2호선", JSON.stringify(positionLine2Sample)],
		["7호선", JSON.stringify(positionLine7Sample)],
	]),
};

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/**
 * `UPSTREAM_MODE=fixture`: 상류를 부르지 않고 `packages/realtime/src/__fixtures__` 표본을 돌려준다.
 * 표본이 없는 노선은 "데이터 없음" 봉투(INFO-200, headerCd 4).
 */
export const fixtureUpstream: Upstream = {
	fetch(url: string): Promise<UpstreamResponse> {
		if (ALL_URL.test(url)) {
			return Promise.resolve({ body: FIXTURE_BODIES.all, status: 200 });
		}
		const position = POSITION_URL.exec(url)?.[1];
		if (position !== undefined) {
			const body =
				FIXTURE_BODIES.position.get(decodeSegment(position)) ?? NO_SUBWAY_DATA;
			return Promise.resolve({ body, status: 200 });
		}
		const routeId = BUS_ROUTE_PARAM.exec(url)?.[1];
		if (routeId !== undefined) {
			const body = FIXTURE_BODIES.bus.get(routeId) ?? NO_BUS_DATA;
			return Promise.resolve({ body, status: 200 });
		}
		return Promise.resolve({ body: "", status: 404 });
	},
};

// ---------------------------------------------------------------------------
// FCM

interface CachedToken {
	expiresAt: number;
	value: string;
}

function accessTokenOf(json: unknown): string | null {
	if (typeof json !== "object" || json === null) {
		return null;
	}
	const token = (json as Record<string, unknown>).access_token;
	return typeof token === "string" && token !== "" ? token : null;
}

/**
 * FCM HTTP v1 알림. 서비스 계정 JSON과 기기 토큰이 둘 다 있을 때만 보내고, 없으면 로그만 남긴다.
 * OAuth 액세스 토큰은 50분 동안 다시 쓴다. 오류 메시지에는 HTTP 상태만 넣는다.
 */
export class FcmNotifier implements Notifier {
	readonly #clock: () => number;
	readonly #deviceToken: string;
	readonly #log: Log;
	readonly #serviceAccountJson: string;
	#token: CachedToken | null = null;

	constructor(options: {
		clock: () => number;
		deviceToken: string | undefined;
		log: Log;
		serviceAccountJson: string | undefined;
	}) {
		this.#clock = options.clock;
		this.#deviceToken = options.deviceToken ?? "";
		this.#log = options.log;
		this.#serviceAccountJson = options.serviceAccountJson ?? "";
	}

	get configured(): boolean {
		return this.#deviceToken !== "" && this.#serviceAccountJson !== "";
	}

	async send(title: string, body: string): Promise<void> {
		if (!this.configured) {
			this.#log(`alert (fcm not configured): ${title} / ${body}`);
			return;
		}
		const token = await this.#accessToken();
		const response = await fetch(
			fcmSendRequest(FCM_PROJECT_ID, token, this.#deviceToken, title, body),
			{ signal: AbortSignal.timeout(FCM_TIMEOUT_MS) }
		);
		if (response.status === 401 || response.status === 403) {
			this.#token = null;
		}
		if (!response.ok) {
			throw new Error(`fcm send failed: HTTP ${response.status}`);
		}
		this.#log(`alert sent: ${title}`);
	}

	async #accessToken(): Promise<string> {
		const now = this.#clock();
		if (this.#token && this.#token.expiresAt > now) {
			return this.#token.value;
		}
		const request = await fcmAccessTokenRequest(this.#serviceAccountJson, now);
		const response = await fetch(request, {
			signal: AbortSignal.timeout(FCM_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(`fcm token request failed: HTTP ${response.status}`);
		}
		const value = accessTokenOf(await response.json());
		if (value === null) {
			throw new Error("fcm token response had no access_token");
		}
		this.#token = { expiresAt: now + FCM_TOKEN_CACHE_MS, value };
		return value;
	}
}

// ---------------------------------------------------------------------------
// 설정

/** 수집기 설정에 쓰는 문자열 변수만 고른다. */
function configEnv(env: Env): EnvLike {
	return {
		BUS_REQUESTS_PER_SECOND: env.BUS_REQUESTS_PER_SECOND,
		DAILY_BUDGET_BUS: env.DAILY_BUDGET_BUS,
		DAILY_BUDGET_SUBWAY: env.DAILY_BUDGET_SUBWAY,
		OPERATING_END_KST: env.OPERATING_END_KST,
		OPERATING_START_KST: env.OPERATING_START_KST,
	};
}

/** `COLLECTOR_MODE`(기본 `dev`). `prod`는 D1 현재 버스 배치의 전 노선을 부른다. */
export async function collectorConfig(
	env: Env,
	reference: D1ReferenceSource
): Promise<CollectorConfig> {
	const mode = env.COLLECTOR_MODE ?? "dev";
	if (mode === "dev") {
		return devConfig(configEnv(env));
	}
	if (mode === "prod") {
		return prodConfig(configEnv(env), await reference.currentBusRouteIds());
	}
	throw new Error(`COLLECTOR_MODE must be dev or prod (got ${mode})`);
}

/** `UPSTREAM_MODE`가 정확히 `live`일 때만 상류를 부른다. 그 밖에는 표본. */
export function upstreamFor(env: Env): {
	mode: "live" | "fixture";
	upstream: Upstream;
} {
	return env.UPSTREAM_MODE === "live"
		? { mode: "live", upstream: liveUpstream }
		: { mode: "fixture", upstream: fixtureUpstream };
}

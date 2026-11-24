import { parseRoute } from "@Betro/commute/plan";
import { lineRef } from "@Betro/commute/refs";
import type { Database } from "@Betro/db";
import { Hono } from "hono";
import { z } from "zod";

import type { CollectorClient } from "../collector/client";
import { authenticateInstall } from "../commute/auth";
import type { CommuteRunnerClient } from "../commute/client";
import type { BusRouteView } from "../commute/runner-core";
import { findSeoulBusRoute, type SeoulBusRouteInfo } from "../ref/bus";
import { stripSubwayPrefix } from "../ref/ids";
import { findLineKey } from "../ref/subway";
import { scheduledTrains } from "./scheduled-trains";
import {
	STATION_VIEW_MAX,
	type StationViewDeps,
	stationView,
} from "./station-view";

export interface MapRoutesDeps {
	/** 버스 관측 요청을 받는 수집기. 없으면 watch는 503이다. */
	collector?: CollectorClient;
	/** 경로 보기를 계산하는 출퇴근 실행기. 없으면 route-view는 503이다. */
	commute?: CommuteRunnerClient;
	db: Database;
	/** 설치 하나가 한 번에 관측을 요청할 수 있는 버스 노선 수. */
	maxRoutesPerInstall: number;
	now?: () => number;
	/** 역 도착판(수집기 행 + 시간표). 없으면 station-view는 503이다. */
	stationView?: Omit<StationViewDeps, "watched">;
	/** 관측 요청이 살아 있는 시간(ms). 앱이 다시 보내지 않으면 이 뒤에 빠진다. */
	watchTtlMs: number;
}

/** 버스 노선 보기 응답. 실행기 값에 D1 노선 정보를 붙인다. 07 제목·배지 색·즐겨찾기에 쓴다(`BusMap`에는 없음). */
export interface BusRouteViewResponse extends BusRouteView {
	route: SeoulBusRouteInfo;
}

const BUS_REF_PREFIX = "seoul-bus:";
const NUMERIC_ID = /^\d+$/;
/** 지역 노선 참조. 수집기가 받는 출처 키와 같은 모양이다. */
const REGIONAL_REF = /^(?:gbis:\d+|tago:[A-Z]{3}\d+)$/;
const MAX_REFS_IN_BODY = 200;

const watchBodySchema = z
	.object({ busRoutes: z.array(z.string().max(64)).max(MAX_REFS_IN_BODY) })
	.strict();

const routeViewBodySchema = z.object({ route: z.unknown() }).strict();

const SEOUL_BUS_LINE = /^seoul-bus:\d+$/;

const busRouteViewBodySchema = z
	.object({ line: z.string().regex(SEOUL_BUS_LINE) })
	.strict();

const SUBWAY_REF_PREFIX = "seoul-subway:";
/** 서울 지하철 역 ID(statnId)는 10자리 숫자다. 길이를 묶어 수집기 관측 목록이 임의 값으로 커지지 않게 한다. */
const SUBWAY_STOP_REF = /^seoul-subway:\d{10}$/;

const stationViewBodySchema = z
	.object({
		stations: z
			.array(
				z
					.object({
						line: z
							.string()
							.refine(
								(line) =>
									line.startsWith(SUBWAY_REF_PREFIX) &&
									findLineKey(line.slice(SUBWAY_REF_PREFIX.length)) !== null
							),
						stop: z.string().regex(SUBWAY_STOP_REF),
					})
					.strict()
			)
			.min(1)
			.max(STATION_VIEW_MAX),
	})
	.strict();

/** 시간표 열차는 앱이 15초마다 받는다. 같은 값을 15초 동안 공유한다. */
const SCHEDULED_CACHE_CONTROL = "public, max-age=15";

const UNAUTHORIZED = { error: "unauthorized" } as const;
const UNAVAILABLE = { error: "unavailable" } as const;

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

/**
 * `seoul-bus:<id>` ref는 접두사 없는 노선 ID로, `gbis:`·`tago:` ref는 출처 키 그대로 뽑는다.
 * 다른 출처는 건너뛰고, 서울 ID가 숫자가 아니거나 지역 ref 모양이 틀리면 null.
 */
function busRouteIdsOf(refs: readonly string[]): string[] | null {
	const ids = new Set<string>();
	for (const ref of refs) {
		if (ref.startsWith("gbis:") || ref.startsWith("tago:")) {
			if (!REGIONAL_REF.test(ref)) {
				return null;
			}
			ids.add(ref);
			continue;
		}
		if (!ref.startsWith(BUS_REF_PREFIX)) {
			continue;
		}
		const id = ref.slice(BUS_REF_PREFIX.length);
		if (!NUMERIC_ID.test(id)) {
			return null;
		}
		ids.add(id);
	}
	return [...ids];
}

/** 지도 API. 좌표·주소·장소 이름은 받지 않고, 요청 본문은 로그에 남기지 않는다. */
export function createMapRoutes(deps: MapRoutesDeps): Hono {
	const { db } = deps;
	const now = deps.now ?? Date.now;
	const routes = new Hono();
	/** 수집기에 등록해 둔 역(역 ID → 만료 시각). isolate마다 하나다. */
	const watchedStations = new Map<string, number>();

	routes.post("/v1/map/watch", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const parsed = watchBodySchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: "invalid" }, 400);
		}
		const ids = busRouteIdsOf(parsed.data.busRoutes);
		if (!ids) {
			return c.json({ error: "invalid" }, 400);
		}
		// 일부만 받아들이지 않는다. 한도를 넘으면 통째로 거절한다.
		if (ids.length > deps.maxRoutesPerInstall) {
			return c.json({ error: "too-many-routes" }, 400);
		}
		if (!deps.collector) {
			return c.json(UNAVAILABLE, 503);
		}
		await deps.collector.watchBusRoutes(
			auth.installId,
			ids,
			now() + deps.watchTtlMs
		);
		return c.body(null, 204);
	});

	routes.post("/v1/map/route-view", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const body = routeViewBodySchema.safeParse(await readJson(c.req.raw));
		if (!body.success) {
			return c.json({ error: "invalid" }, 400);
		}
		const route = parseRoute(body.data.route);
		if (!route.ok) {
			return c.json({ error: "invalid" }, 400);
		}
		if (!deps.commute) {
			return c.json(UNAVAILABLE, 503);
		}
		const view = await deps.commute.routeView(route.route);
		c.header("Cache-Control", "no-store");
		return c.json(view);
	});

	routes.post("/v1/map/bus-route-view", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const body = busRouteViewBodySchema.safeParse(await readJson(c.req.raw));
		if (!body.success) {
			return c.json({ error: "invalid" }, 400);
		}
		const routeId = body.data.line.slice(BUS_REF_PREFIX.length);
		// 경기·인천 노선은 07이 없다. 서울 출처의 경기·인천 면허 노선도 여기서 거른다(지도 몫 서울 한도를 쓰지 않게).
		const found = await findSeoulBusRoute(db, routeId);
		if (!found) {
			return c.json(UNAVAILABLE, 503);
		}
		if (!found.route) {
			return c.json({ error: "invalid" }, 400);
		}
		if (!deps.commute) {
			return c.json(UNAVAILABLE, 503);
		}
		const view = await deps.commute.busRouteView(lineRef("seoul-bus", routeId));
		const response: BusRouteViewResponse = { ...view, route: found.route };
		c.header("Cache-Control", "no-store");
		return c.json(response);
	});

	routes.post("/v1/map/station-view", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const body = stationViewBodySchema.safeParse(await readJson(c.req.raw));
		if (!body.success) {
			return c.json({ error: "invalid" }, 400);
		}
		if (!deps.stationView) {
			return c.json(UNAVAILABLE, 503);
		}
		const view = await stationView(
			{ ...deps.stationView, watched: watchedStations },
			body.data.stations,
			now()
		);
		c.header("Cache-Control", "no-store");
		return c.json(view);
	});

	// 시간표 추정 모드(14)의 시간표 위치 열차. 노선 키만 받는 공개 GET이다.
	routes.get("/v1/map/scheduled/:lineKey", async (c) => {
		const lineKey = findLineKey(stripSubwayPrefix(c.req.param("lineKey")));
		if (!lineKey) {
			return c.json({ error: "line not found" }, 404);
		}
		const result = await scheduledTrains(db, lineKey, now());
		if (!result) {
			return c.json(UNAVAILABLE, 503);
		}
		c.header("Cache-Control", SCHEDULED_CACHE_CONTROL);
		return c.json(result);
	});

	return routes;
}

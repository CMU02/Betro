import { parseRoute } from "@Betro/commute/plan";
import type { Database } from "@Betro/db";
import { Hono } from "hono";
import { z } from "zod";

import type { CollectorClient } from "../collector/client";
import { authenticateInstall } from "../commute/auth";
import type { CommuteRunnerClient } from "../commute/client";

export interface MapRoutesDeps {
	/** 버스 관측 요청을 받는 수집기. 없으면 watch는 503이다. */
	collector?: CollectorClient;
	/** 경로 보기를 계산하는 출퇴근 실행기. 없으면 route-view는 503이다. */
	commute?: CommuteRunnerClient;
	db: Database;
	/** 설치 하나가 한 번에 관측을 요청할 수 있는 버스 노선 수. */
	maxRoutesPerInstall: number;
	now?: () => number;
	/** 관측 요청이 살아 있는 시간(ms). 앱이 다시 보내지 않으면 이 뒤에 빠진다. */
	watchTtlMs: number;
}

const BUS_REF_PREFIX = "seoul-bus:";
const NUMERIC_ID = /^\d+$/;
const MAX_REFS_IN_BODY = 200;

const watchBodySchema = z
	.object({ busRoutes: z.array(z.string().max(64)).max(MAX_REFS_IN_BODY) })
	.strict();

const routeViewBodySchema = z.object({ route: z.unknown() }).strict();

const UNAUTHORIZED = { error: "unauthorized" } as const;
const UNAVAILABLE = { error: "unavailable" } as const;

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

/** `seoul-bus:<id>` ref에서 접두사 없는 노선 ID만 뽑는다. 다른 출처는 건너뛰고, 숫자가 아니면 null. */
function busRouteIdsOf(refs: readonly string[]): string[] | null {
	const ids = new Set<string>();
	for (const ref of refs) {
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

	return routes;
}

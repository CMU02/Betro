import { type CommutePlan, parsePlan } from "@Betro/commute/plan";
import type { Database } from "@Betro/db";
import {
	commutePlan,
	commuteSession,
	install,
	pushToken,
} from "@Betro/db/schema/commute";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { authenticateInstall } from "./auth";

export interface CommuteRoutesDeps {
	db: Database;
	now?: () => number;
}

const MAX_PLANS_PER_INSTALL = 16;
const MINUTES_PER_DAY = 1440;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const installBodySchema = z
	.object({
		installId: z.string().min(1).max(64),
		platform: z.enum(["ios", "android"]),
		secretHash: z.string().regex(SHA256_HEX),
	})
	.strict();

const pushTokenBodySchema = z
	.object({
		activityId: z.string().max(128).optional(),
		env: z.enum(["sandbox", "production"]),
		kind: z.enum(["apns-start", "apns-activity", "fcm"]),
		sessionId: z.string().max(128).optional(),
		token: z.string().min(1).max(4096),
	})
	.strict();

const UNAUTHORIZED = { error: "unauthorized" } as const;

/** 예약 시작 시각(나가는 시각에서 선행을 뺀 분). 자정을 넘기면 전날로 돈다. */
export function startMinuteOf(
	leaveMinute: number,
	leadMinutes: number
): number {
	return (
		(((leaveMinute - leadMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
		MINUTES_PER_DAY
	);
}

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

export function createCommuteRoutes(deps: CommuteRoutesDeps): Hono {
	const { db } = deps;
	const now = deps.now ?? Date.now;
	const routes = new Hono();

	routes.post("/v1/installs", async (c) => {
		const parsed = installBodySchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: "invalid" }, 400);
		}
		const { installId, platform, secretHash } = parsed.data;
		const [existing] = await db
			.select({ secretHash: install.secretHash })
			.from(install)
			.where(eq(install.id, installId))
			.limit(1);
		if (existing) {
			return existing.secretHash === secretHash
				? c.body(null, 200)
				: c.json({ error: "conflict" }, 409);
		}
		const at = now();
		await db.insert(install).values({
			createdAt: at,
			id: installId,
			lastSeenAt: at,
			platform,
			secretHash,
		});
		return c.body(null, 201);
	});

	routes.put("/v1/push-tokens", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const parsed = pushTokenBodySchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: "invalid" }, 400);
		}
		const { env, kind, token } = parsed.data;
		const activityId = parsed.data.activityId ?? "";
		const sessionId = parsed.data.sessionId ?? "";
		await db
			.insert(pushToken)
			.values({
				activityId,
				env,
				installId: auth.installId,
				kind,
				sessionId,
				token,
				updatedAt: now(),
			})
			.onConflictDoUpdate({
				set: { env, sessionId, token, updatedAt: now() },
				target: [pushToken.installId, pushToken.kind, pushToken.activityId],
			});
		return c.body(null, 204);
	});

	routes.put("/v1/commute/plans/:planId", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const parsed = parsePlan(await readJson(c.req.raw));
		if (!parsed.ok) {
			return c.json({ error: "invalid", issues: parsed.issues }, 400);
		}
		const { plan } = parsed;
		if (plan.planId !== c.req.param("planId")) {
			return c.json({ error: "plan id mismatch" }, 400);
		}
		const [owned] = await db
			.select({ installId: commutePlan.installId })
			.from(commutePlan)
			.where(eq(commutePlan.id, plan.planId))
			.limit(1);
		if (owned && owned.installId !== auth.installId) {
			return c.json({ error: "not found" }, 404);
		}
		if (!owned) {
			const [{ total } = { total: 0 }] = await db
				.select({ total: count() })
				.from(commutePlan)
				.where(eq(commutePlan.installId, auth.installId));
			if (total >= MAX_PLANS_PER_INSTALL) {
				return c.json({ error: "too many plans" }, 409);
			}
		}
		const row = {
			enabled: plan.enabled ? 1 : 0,
			installId: auth.installId,
			planJson: plan,
			startMinute: startMinuteOf(
				plan.schedule.leaveMinute,
				plan.schedule.leadMinutes
			),
			timezone: plan.schedule.timezone,
			updatedAt: now(),
		};
		await db
			.insert(commutePlan)
			.values({ ...row, id: plan.planId })
			.onConflictDoUpdate({
				set: row,
				setWhere: eq(commutePlan.installId, auth.installId),
				target: commutePlan.id,
			});
		return c.body(null, 204);
	});

	routes.get("/v1/commute/plans", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const rows = await db
			.select({ planJson: commutePlan.planJson })
			.from(commutePlan)
			.where(eq(commutePlan.installId, auth.installId))
			.orderBy(commutePlan.updatedAt);
		const plans: CommutePlan[] = rows.map((row) => row.planJson);
		return c.json({ plans });
	});

	routes.delete("/v1/commute/plans/:planId", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		await db
			.delete(commutePlan)
			.where(
				and(
					eq(commutePlan.id, c.req.param("planId")),
					eq(commutePlan.installId, auth.installId)
				)
			);
		return c.body(null, 204);
	});

	routes.delete("/v1/installs/me", async (c) => {
		const auth = await authenticateInstall(db, c.req.raw.headers, now());
		if (!auth) {
			return c.json(UNAUTHORIZED, 401);
		}
		const { installId } = auth;
		await db.delete(pushToken).where(eq(pushToken.installId, installId));
		await db.delete(commutePlan).where(eq(commutePlan.installId, installId));
		await db
			.delete(commuteSession)
			.where(eq(commuteSession.installId, installId));
		await db.delete(install).where(eq(install.id, installId));
		return c.body(null, 204);
	});

	return routes;
}

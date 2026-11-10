import {
	commutePlan,
	commuteSession,
	install,
	pushToken,
} from "@Betro/db/schema/commute";
import { createTestDb } from "@Betro/db/test-db";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { sha256Hex } from "./auth";
import type { CommuteRunnerClient } from "./client";
import { createCommuteRoutes } from "./routes";

const INSTALL_A = "11111111-1111-4111-8111-111111111111";
const INSTALL_B = "22222222-2222-4222-8222-222222222222";
const SECRET_A = "secret-a-secret-a-secret-a-secret-a-0001";
const SECRET_B = "secret-b-secret-b-secret-b-secret-b-0002";
const PLAN_ID = "3f2b8c1e-5d4a-4b7e-9c10-1a2b3c4d5e6f";
const BASE = "https://betro.test";
const MAX_PLANS = 16;

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const ENDED_SESSION_ID = "55555555-5555-4555-8555-555555555555";

let db: TestDb;
let app: Hono;
let nowMs = Date.UTC(2026, 10, 10, 0, 0, 0);
let runnerCalls: unknown[][] = [];

/** 실행기 DO 대신. INSTALL_A의 SESSION_ID만 진행 중이고 ENDED_SESSION_ID는 끝났다. */
const fakeRunner: CommuteRunnerClient = {
	ack: (installId, sessionId, at) => {
		runnerCalls.push(["ack", installId, sessionId, at]);
		return Promise.resolve(
			installId === INSTALL_A && sessionId === SESSION_ID ? "ok" : "not-found"
		);
	},
	activeSession: (installId) => {
		runnerCalls.push(["active", installId]);
		if (installId !== INSTALL_A) {
			return Promise.resolve(null);
		}
		return Promise.resolve({
			content: { seq: 3, stage: "walk" } as never,
			planId: PLAN_ID,
			sessionId: SESSION_ID,
		});
	},
	healthCheck: () => Promise.resolve(),
	input: (installId, sessionId, input) => {
		runnerCalls.push(["input", installId, sessionId, input.kind]);
		if (installId !== INSTALL_A) {
			return Promise.resolve("not-found");
		}
		if (sessionId === ENDED_SESSION_ID) {
			return Promise.resolve("ended");
		}
		return Promise.resolve(sessionId === SESSION_ID ? "ok" : "not-found");
	},
	writeDailyReport: () => Promise.resolve(false),
};

beforeEach(async () => {
	db = await createTestDb();
	nowMs = Date.UTC(2026, 10, 10, 0, 0, 0);
	runnerCalls = [];
	app = new Hono();
	app.route(
		"/",
		createCommuteRoutes({ commute: fakeRunner, db, now: () => nowMs })
	);
});

function makePlan(
	planId = PLAN_ID,
	overrides: {
		enabled?: boolean;
		leaveMinute?: number;
		leadMinutes?: number;
	} = {}
) {
	return {
		enabled: overrides.enabled ?? true,
		planId,
		routes: [
			{
				legs: [
					{
						alight: { name: "나", seq: 20, stop: "seoul-bus:119000022" },
						board: { name: "가", seq: 3, stop: "seoul-bus:119000011" },
						line: "seoul-bus:100100290",
						lineName: "6411",
						mode: "bus",
					},
				],
				rank: 0,
				walkMinutes: [5, 3],
			},
		],
		schedule: {
			days: [1, 2, 3, 4, 5],
			includeHolidays: false,
			leadMinutes: overrides.leadMinutes ?? 10,
			leaveMinute: overrides.leaveMinute ?? 490,
			timezone: "Asia/Seoul",
		},
	};
}

function uuidN(n: number): string {
	return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function authHeaders(installId = INSTALL_A, secret = SECRET_A) {
	return {
		Authorization: `Bearer ${secret}`,
		"Content-Type": "application/json",
		"X-Betro-Install": installId,
	};
}

async function register(installId = INSTALL_A, secret = SECRET_A) {
	return await app.request(`${BASE}/v1/installs`, {
		body: JSON.stringify({
			installId,
			platform: "ios",
			secretHash: await sha256Hex(secret),
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
}

function putPlan(plan: unknown, planId: string, headers = authHeaders()) {
	return app.request(`${BASE}/v1/commute/plans/${planId}`, {
		body: JSON.stringify(plan),
		headers,
		method: "PUT",
	});
}

describe("installs", () => {
	test("registers a new install with 201", async () => {
		const res = await register();
		expect(res.status).toBe(201);
	});

	test("same install and hash again is 200", async () => {
		await register();
		const res = await register();
		expect(res.status).toBe(200);
	});

	test("same install with a different hash is 409", async () => {
		await register();
		const res = await register(INSTALL_A, SECRET_B);
		expect(res.status).toBe(409);
	});

	test("unknown platform is 400", async () => {
		const res = await app.request(`${BASE}/v1/installs`, {
			body: JSON.stringify({
				installId: INSTALL_A,
				platform: "web",
				secretHash: await sha256Hex(SECRET_A),
			}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		expect(res.status).toBe(400);
	});
});

describe("authentication", () => {
	test("missing header, wrong secret and unknown install all give the same 401", async () => {
		await register();
		const missing = await app.request(`${BASE}/v1/commute/plans`);
		const wrong = await app.request(`${BASE}/v1/commute/plans`, {
			headers: authHeaders(INSTALL_A, SECRET_B),
		});
		const unknown = await app.request(`${BASE}/v1/commute/plans`, {
			headers: authHeaders(INSTALL_B, SECRET_B),
		});
		const bodies = await Promise.all(
			[missing, wrong, unknown].map((res) => res.text())
		);
		expect([missing.status, wrong.status, unknown.status]).toEqual([
			401, 401, 401,
		]);
		expect(bodies[0]).toBe(JSON.stringify({ error: "unauthorized" }));
		expect(bodies[1]).toBe(bodies[0]);
		expect(bodies[2]).toBe(bodies[0]);
	});

	test("last_seen_at is refreshed at most once a day", async () => {
		await register();
		const [first] = await db.select().from(install);
		nowMs += 60 * 60 * 1000;
		await app.request(`${BASE}/v1/commute/plans`, { headers: authHeaders() });
		const [sameDay] = await db.select().from(install);
		expect(sameDay?.lastSeenAt).toBe(first?.lastSeenAt as number);
		nowMs += 25 * 60 * 60 * 1000;
		await app.request(`${BASE}/v1/commute/plans`, { headers: authHeaders() });
		const [nextDay] = await db.select().from(install);
		expect(nextDay?.lastSeenAt).toBe(nowMs);
	});
});

describe("push tokens", () => {
	test("uploading the same (kind, activityId) twice keeps one row with the new token", async () => {
		await register();
		const upload = (token: string) =>
			app.request(`${BASE}/v1/push-tokens`, {
				body: JSON.stringify({
					activityId: "act-1",
					env: "sandbox",
					kind: "apns-activity",
					sessionId: "sess-1",
					token,
				}),
				headers: authHeaders(),
				method: "PUT",
			});
		expect((await upload("token-one")).status).toBe(204);
		expect((await upload("token-two")).status).toBe(204);
		const rows = await db.select().from(pushToken);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.token).toBe("token-two");
		expect(rows[0]?.activityId).toBe("act-1");
	});

	test("activityId defaults to an empty string and the secret is never stored", async () => {
		await register();
		await app.request(`${BASE}/v1/push-tokens`, {
			body: JSON.stringify({ env: "production", kind: "fcm", token: "fcm-1" }),
			headers: authHeaders(),
			method: "PUT",
		});
		const rows = await db.select().from(pushToken);
		expect(rows[0]?.activityId).toBe("");
		expect(rows[0]?.sessionId).toBe("");
		const dump = JSON.stringify([rows, await db.select().from(install)]);
		expect(dump).not.toContain(SECRET_A);
	});

	test("response bodies never contain the secret", async () => {
		const reg = await register();
		const put = await app.request(`${BASE}/v1/push-tokens`, {
			body: JSON.stringify({ env: "production", kind: "fcm", token: "fcm-1" }),
			headers: authHeaders(),
			method: "PUT",
		});
		const bad = await app.request(`${BASE}/v1/push-tokens`, {
			body: JSON.stringify({ kind: "nope" }),
			headers: authHeaders(),
			method: "PUT",
		});
		const texts = await Promise.all([reg.text(), put.text(), bad.text()]);
		expect(texts.join("")).not.toContain(SECRET_A);
	});

	test("requires authentication", async () => {
		const res = await app.request(`${BASE}/v1/push-tokens`, {
			body: JSON.stringify({ env: "production", kind: "fcm", token: "x" }),
			headers: { "Content-Type": "application/json" },
			method: "PUT",
		});
		expect(res.status).toBe(401);
	});
});

describe("commute plans", () => {
	test("saved plan reads back as the same object", async () => {
		await register();
		const plan = makePlan();
		expect((await putPlan(plan, PLAN_ID)).status).toBe(204);
		const res = await app.request(`${BASE}/v1/commute/plans`, {
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ plans: [plan] });
	});

	test("saving again with enabled false changes only enabled", async () => {
		await register();
		await putPlan(makePlan(), PLAN_ID);
		await putPlan(makePlan(PLAN_ID, { enabled: false }), PLAN_ID);
		const res = await app.request(`${BASE}/v1/commute/plans`, {
			headers: authHeaders(),
		});
		const { plans } = (await res.json()) as {
			plans: ReturnType<typeof makePlan>[];
		};
		expect(plans).toHaveLength(1);
		expect(plans[0]).toEqual(makePlan(PLAN_ID, { enabled: false }));
		const [row] = await db.select().from(commutePlan);
		expect(row?.enabled).toBe(0);
	});

	test("start_minute is 1435 for leaveMinute 5 and leadMinutes 10", async () => {
		await register();
		await putPlan(
			makePlan(PLAN_ID, { leadMinutes: 10, leaveMinute: 5 }),
			PLAN_ID
		);
		const [row] = await db.select().from(commutePlan);
		expect(row?.startMinute).toBe(1435);
		expect(row?.timezone).toBe("Asia/Seoul");
	});

	test("another install putting the same planId gets 404 and the original stays", async () => {
		await register();
		await register(INSTALL_B, SECRET_B);
		await putPlan(makePlan(), PLAN_ID);
		const res = await putPlan(
			makePlan(PLAN_ID, { enabled: false }),
			PLAN_ID,
			authHeaders(INSTALL_B, SECRET_B)
		);
		expect(res.status).toBe(404);
		const [row] = await db.select().from(commutePlan);
		expect(row?.installId).toBe(INSTALL_A);
		expect(row?.enabled).toBe(1);
	});

	test("the 17th plan is 409", async () => {
		await register();
		const numbers = Array.from({ length: MAX_PLANS }, (_, i) => i + 1);
		const statuses = await Promise.all(
			numbers.map(
				async (n) => (await putPlan(makePlan(uuidN(n)), uuidN(n))).status
			)
		);
		expect(statuses.every((status) => status === 204)).toBe(true);
		const res = await putPlan(makePlan(uuidN(17)), uuidN(17));
		expect(res.status).toBe(409);
		// 기존 경로를 고치는 것은 가득 차도 된다.
		const update = await putPlan(makePlan(uuidN(1)), uuidN(1));
		expect(update.status).toBe(204);
	});

	test("planId in the body must match the path", async () => {
		await register();
		const res = await putPlan(makePlan(uuidN(2)), uuidN(3));
		expect(res.status).toBe(400);
	});

	test("schema violations are 400 with issues", async () => {
		await register();
		const bad = { ...makePlan(), routes: [] };
		const res = await putPlan(bad, PLAN_ID);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; issues: string[] };
		expect(body.error).toBe("invalid");
		expect(body.issues.length).toBeGreaterThan(0);
	});

	test("requires authentication", async () => {
		const res = await putPlan(makePlan(), PLAN_ID, {
			"Content-Type": "application/json",
		} as ReturnType<typeof authHeaders>);
		expect(res.status).toBe(401);
	});

	test("delete removes the plan and is 204 even when missing", async () => {
		await register();
		await putPlan(makePlan(), PLAN_ID);
		const first = await app.request(`${BASE}/v1/commute/plans/${PLAN_ID}`, {
			headers: authHeaders(),
			method: "DELETE",
		});
		const second = await app.request(`${BASE}/v1/commute/plans/${PLAN_ID}`, {
			headers: authHeaders(),
			method: "DELETE",
		});
		expect([first.status, second.status]).toEqual([204, 204]);
		expect(await db.select().from(commutePlan)).toHaveLength(0);
	});

	test("delete cannot remove another install's plan", async () => {
		await register();
		await register(INSTALL_B, SECRET_B);
		await putPlan(makePlan(), PLAN_ID);
		const res = await app.request(`${BASE}/v1/commute/plans/${PLAN_ID}`, {
			headers: authHeaders(INSTALL_B, SECRET_B),
			method: "DELETE",
		});
		expect(res.status).toBe(204);
		expect(await db.select().from(commutePlan)).toHaveLength(1);
	});
});

describe("install deletion", () => {
	test("removes tokens, plans and sessions, and the secret stops working", async () => {
		await register();
		await register(INSTALL_B, SECRET_B);
		await putPlan(makePlan(), PLAN_ID);
		await app.request(`${BASE}/v1/push-tokens`, {
			body: JSON.stringify({ env: "production", kind: "fcm", token: "t" }),
			headers: authHeaders(),
			method: "PUT",
		});
		await db.insert(commuteSession).values({
			id: "sess-1",
			installId: INSTALL_A,
			planId: PLAN_ID,
			serviceDate: "2026-11-10",
			startedAt: nowMs,
			status: "active",
		});
		const res = await app.request(`${BASE}/v1/installs/me`, {
			headers: authHeaders(),
			method: "DELETE",
		});
		expect(res.status).toBe(204);
		const after = await app.request(`${BASE}/v1/commute/plans`, {
			headers: authHeaders(),
		});
		expect(after.status).toBe(401);
		expect(
			await db
				.select()
				.from(pushToken)
				.where(eq(pushToken.installId, INSTALL_A))
		).toHaveLength(0);
		expect(await db.select().from(commutePlan)).toHaveLength(0);
		expect(await db.select().from(commuteSession)).toHaveLength(0);
		expect(await db.select().from(install)).toHaveLength(1);
	});
});

describe("commute sessions", () => {
	function postInput(
		sessionId: string,
		body: unknown,
		headers = authHeaders()
	) {
		return app.request(`${BASE}/v1/commute/sessions/${sessionId}/input`, {
			body: JSON.stringify(body),
			headers,
			method: "POST",
		});
	}

	test("input is 204 for the install's own session and reaches the runner", async () => {
		await register();
		const res = await postInput(SESSION_ID, { kind: "boarded" });
		expect(res.status).toBe(204);
		expect(runnerCalls).toEqual([["input", INSTALL_A, SESSION_ID, "boarded"]]);
	});

	test("input for another install's or a missing session is 404, an ended session is 409", async () => {
		await register();
		await register(INSTALL_B, SECRET_B);
		const other = await postInput(
			SESSION_ID,
			{ kind: "next" },
			authHeaders(INSTALL_B, SECRET_B)
		);
		expect(other.status).toBe(404);
		const missing = await postInput(uuidN(9), { kind: "next" });
		expect(missing.status).toBe(404);
		const ended = await postInput(ENDED_SESSION_ID, { kind: "end" });
		expect(ended.status).toBe(409);
	});

	test("input needs authentication and a known kind", async () => {
		await register();
		const unauth = await postInput(SESSION_ID, { kind: "end" }, {
			"Content-Type": "application/json",
		} as never);
		expect(unauth.status).toBe(401);
		const bad = await postInput(SESSION_ID, { kind: "jump" });
		expect(bad.status).toBe(400);
		const extra = await postInput(SESSION_ID, { at: 1, kind: "end" });
		expect(extra.status).toBe(400);
		expect(runnerCalls).toEqual([]);
	});

	test("ack records the first shown time with 204, 404 for others", async () => {
		await register();
		const shownAt = nowMs + 5000;
		const res = await app.request(
			`${BASE}/v1/commute/sessions/${SESSION_ID}/ack`,
			{
				body: JSON.stringify({ shownAt }),
				headers: authHeaders(),
				method: "POST",
			}
		);
		expect(res.status).toBe(204);
		expect(runnerCalls).toEqual([["ack", INSTALL_A, SESSION_ID, shownAt]]);
		const missing = await app.request(
			`${BASE}/v1/commute/sessions/${uuidN(9)}/ack`,
			{
				body: JSON.stringify({ shownAt }),
				headers: authHeaders(),
				method: "POST",
			}
		);
		expect(missing.status).toBe(404);
		const bad = await app.request(
			`${BASE}/v1/commute/sessions/${SESSION_ID}/ack`,
			{
				body: JSON.stringify({ shownAt: "soon" }),
				headers: authHeaders(),
				method: "POST",
			}
		);
		expect(bad.status).toBe(400);
	});

	test("active returns the install's session or null", async () => {
		await register();
		await register(INSTALL_B, SECRET_B);
		const mine = await app.request(`${BASE}/v1/commute/sessions/active`, {
			headers: authHeaders(),
		});
		expect(mine.status).toBe(200);
		expect(await mine.json()).toEqual({
			session: {
				content: { seq: 3, stage: "walk" },
				planId: PLAN_ID,
				sessionId: SESSION_ID,
			},
		});
		const theirs = await app.request(`${BASE}/v1/commute/sessions/active`, {
			headers: authHeaders(INSTALL_B, SECRET_B),
		});
		expect(await theirs.json()).toEqual({ session: null });
	});

	test("without a runner the session routes are 503", async () => {
		await register();
		const bare = new Hono();
		bare.route("/", createCommuteRoutes({ db, now: () => nowMs }));
		const res = await bare.request(`${BASE}/v1/commute/sessions/active`, {
			headers: authHeaders(),
		});
		expect(res.status).toBe(503);
	});
});

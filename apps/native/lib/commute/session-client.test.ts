import { describe, expect, it } from "bun:test";

import type { ServerClient, ServerResponse } from "../server/api-client";
import fixture from "./__fixtures__/lock-screen-cases.json";
import type { ContentState } from "./content-state";
import {
	type ActiveSessionView,
	endOutcome,
	endSession,
	fetchActiveSession,
	settleActiveSession,
} from "./session-client";

interface Call {
	body: unknown;
	method: string;
	path: string;
}

function fakeClient(response: ServerResponse): {
	calls: Call[];
	client: ServerClient;
} {
	const calls: Call[] = [];
	return {
		calls,
		client: {
			request: (method, path, body) => {
				calls.push({ body, method, path });
				return Promise.resolve(response);
			},
		},
	};
}

const CONTENT = (fixture.cases[4] as { state: ContentState }).state;
const PLAN_ID = "7d1f3c2a-9b8e-4c5d-a6f7-0e1d2c3b4a59";
const SESSION_ID = "session-1";

const MAIN_ROUTE = {
	boardEtaEpoch: 1_794_265_680,
	destinationEtaEpoch: 1_794_267_600,
	etaState: "live",
	positionState: "live",
	rank: 0,
	stopsAway: 1,
};
const ALT_ROUTE = {
	boardEtaEpoch: null,
	destinationEtaEpoch: null,
	etaState: "estimated",
	positionState: "none",
	rank: 1,
	stopsAway: null,
};

function sessionJson(overrides: Record<string, unknown> = {}) {
	return {
		session: {
			content: CONTENT,
			planId: PLAN_ID,
			routes: [ALT_ROUTE, MAIN_ROUTE],
			sessionId: SESSION_ID,
			...overrides,
		},
	};
}

describe("fetchActiveSession", () => {
	it("reads no session", async () => {
		const { client, calls } = fakeClient({
			json: { session: null },
			status: 200,
		});
		expect(await fetchActiveSession(client)).toEqual({
			ok: true,
			session: null,
		});
		expect(calls).toEqual([
			{
				body: undefined,
				method: "GET",
				path: "/v1/commute/sessions/active",
			},
		]);
	});

	it("reads a running session and sorts the routes by rank", async () => {
		const { client } = fakeClient({ json: sessionJson(), status: 200 });
		expect(await fetchActiveSession(client)).toEqual({
			ok: true,
			session: {
				content: CONTENT,
				planId: PLAN_ID,
				routes: [MAIN_ROUTE, ALT_ROUTE] as ActiveSessionView["routes"],
				sessionId: SESSION_ID,
			},
		});
	});

	it("reads a server without per-route estimates as no routes", async () => {
		const json = sessionJson();
		const { routes: _routes, ...withoutRoutes } = json.session;
		const { client } = fakeClient({
			json: { session: withoutRoutes },
			status: 200,
		});
		const result = await fetchActiveSession(client);
		expect(result.ok && result.session?.routes).toEqual([]);
	});

	it("rejects content that does not parse", async () => {
		const { client } = fakeClient({
			json: sessionJson({ content: { ...CONTENT, v: 2 } }),
			status: 200,
		});
		expect(await fetchActiveSession(client)).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("rejects a malformed route or a missing session id", async () => {
		const badRoute = fakeClient({
			json: sessionJson({ routes: [{ ...MAIN_ROUTE, etaState: "soon" }] }),
			status: 200,
		});
		expect(await fetchActiveSession(badRoute.client)).toEqual({
			ok: false,
			reason: "invalid",
		});
		const notArray = fakeClient({
			json: sessionJson({ routes: "x" }),
			status: 200,
		});
		expect(await fetchActiveSession(notArray.client)).toEqual({
			ok: false,
			reason: "invalid",
		});
		const noId = fakeClient({
			json: sessionJson({ sessionId: 3 }),
			status: 200,
		});
		expect(await fetchActiveSession(noId.client)).toEqual({
			ok: false,
			reason: "invalid",
		});
		const noBody = fakeClient({ json: null, status: 200 });
		expect(await fetchActiveSession(noBody.client)).toEqual({
			ok: false,
			reason: "invalid",
		});
	});

	it("reads a network failure as offline", async () => {
		const { client } = fakeClient({ json: null, status: 0 });
		expect(await fetchActiveSession(client)).toEqual({
			ok: false,
			reason: "offline",
		});
	});

	it("reads other statuses (401, 503, 500) as offline", async () => {
		const results = await Promise.all(
			[401, 503, 500].map((status) =>
				fetchActiveSession(fakeClient({ json: { error: "x" }, status }).client)
			)
		);
		for (const result of results) {
			expect(result).toEqual({ ok: false, reason: "offline" });
		}
	});
});

describe("endSession", () => {
	it("posts kind end to the session input", async () => {
		const { client, calls } = fakeClient({ json: null, status: 204 });
		expect(await endSession(client, "a/b")).toBe("ok");
		expect(calls).toEqual([
			{
				body: { kind: "end" },
				method: "POST",
				path: "/v1/commute/sessions/a%2Fb/input",
			},
		]);
	});

	it("reads 409 and 404 as already ended", async () => {
		expect(
			await endSession(fakeClient({ json: null, status: 409 }).client, "s")
		).toBe("ended");
		expect(
			await endSession(fakeClient({ json: null, status: 404 }).client, "s")
		).toBe("ended");
	});

	it("reads 500 and a network failure as failed", async () => {
		expect(
			await endSession(fakeClient({ json: null, status: 500 }).client, "s")
		).toBe("failed");
		expect(
			await endSession(fakeClient({ json: null, status: 0 }).client, "s")
		).toBe("failed");
	});
});

describe("settleActiveSession", () => {
	const session: ActiveSessionView = {
		content: CONTENT,
		planId: PLAN_ID,
		routes: [],
		sessionId: SESSION_ID,
	};

	it("takes a good answer as it is", () => {
		expect(settleActiveSession(undefined, { ok: true, session })).toEqual({
			checking: false,
			session,
		});
		expect(
			settleActiveSession(
				{ checking: true, session },
				{ ok: true, session: null }
			)
		).toEqual({ checking: false, session: null });
	});

	it("keeps the last session when offline or invalid", () => {
		const last = { checking: false, session };
		expect(settleActiveSession(last, { ok: false, reason: "offline" })).toEqual(
			{ checking: true, session }
		);
		expect(settleActiveSession(last, { ok: false, reason: "invalid" })).toEqual(
			{ checking: true, session }
		);
	});

	it("has no session when the first answer fails", () => {
		expect(
			settleActiveSession(undefined, { ok: false, reason: "offline" })
		).toEqual({ checking: true, session: null });
	});
});

describe("endOutcome", () => {
	it("refetches after ok, clears after ended and asks again after failed", () => {
		expect(endOutcome("ok")).toEqual({ clear: false, notice: null });
		expect(endOutcome("ended")).toEqual({ clear: true, notice: null });
		expect(endOutcome("failed")).toEqual({
			clear: false,
			notice: "commuteGuide.endFailed",
		});
	});
});

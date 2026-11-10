import { createAuth } from "@Betro/auth";
import { createTestDb } from "@Betro/db/test-db";
import type { CollectorStatus } from "@Betro/realtime/metrics";
import { beforeAll, describe, expect, test } from "bun:test";

import { createApp, ifNoneMatchMatches } from "./app";
import type { CollectorClient } from "./collector/client";

const API_HOST = "betro.cmu02-studio.com";
const STATUS_HOST = "betro-status.cmu02-studio.com";
const API = `https://${API_HOST}`;
const STATUS = `https://${STATUS_HOST}`;
const LOCAL_ORIGIN = "http://localhost:8081";
const TEST_SECRET = "test-secret-test-secret-test-secret-0123";

type App = ReturnType<typeof createApp>;

let app: App;
/** 가짜 수집기를 붙인 앱. */
let appWithCollector: App;
const collectorCalls = { start: 0, status: 0 };

const SNAPSHOT_ETAG = "0123456789abcdef";
const SNAPSHOT_BODY = JSON.stringify({
	generatedAt: 1,
	staleSince: null,
	vehicles: [],
});
/** 2026-11-04 12:00:00 KST */
const STATUS_AT = Date.UTC(2026, 10, 4, 3, 0, 0);

const fakeStatus: CollectorStatus = {
	generatedAt: STATUS_AT,
	lines: [
		{
			backwards: 0,
			baselineRatio: null,
			key: "line2",
			matchRate: 0.9,
			unknownStations: 0,
			vehicles: 40,
		},
	],
	mode: "dev",
	overall: "ok",
	series: [],
	sources: [
		{
			errorsToday: {},
			freshnessMs: 20_000,
			health: "ok",
			lastSuccessAt: STATUS_AT - 60_000,
			name: "subway",
			remainingToday: 800,
			usedToday: 100,
		},
	],
};

const fakeCollector: CollectorClient = {
	snapshot: (kind) =>
		Promise.resolve({ body: SNAPSHOT_BODY, etag: `${SNAPSHOT_ETAG}-${kind}` }),
	start: () => {
		collectorCalls.start += 1;
		return Promise.resolve({ alarmAt: STATUS_AT, alreadyRunning: false });
	},
	status: () => {
		collectorCalls.status += 1;
		return Promise.resolve(fakeStatus);
	},
};

beforeAll(async () => {
	const db = await createTestDb();
	const auth = createAuth(
		{
			BETTER_AUTH_SECRET: TEST_SECRET,
			BETTER_AUTH_URL: API,
			CORS_ORIGIN: LOCAL_ORIGIN,
		},
		db
	);
	app = createApp({
		apiHost: API_HOST,
		auth,
		corsOrigins: [LOCAL_ORIGIN],
		db,
		statusHost: STATUS_HOST,
	});
	appWithCollector = createApp({
		apiHost: API_HOST,
		auth,
		collector: fakeCollector,
		corsOrigins: [LOCAL_ORIGIN],
		db,
		statusHost: STATUS_HOST,
	});
});

/** oRPC RPC 프로토콜(POST, 본문 `{ json }`)로 프로시저를 부른다. */
async function callRpc(path: string, headers: Record<string, string> = {}) {
	const res = await app.request(`${API}/rpc/${path}`, {
		body: JSON.stringify({}),
		headers: { "content-type": "application/json", ...headers },
		method: "POST",
	});
	const payload = (await res.json()) as { json: unknown };
	return { json: payload.json, status: res.status };
}

function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
}

describe("createApp", () => {
	test("serves health on api host", async () => {
		const res = await app.request(`${API}/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("OK");
	});

	test("mounts /v1 commute routes and allows the install header in CORS", async () => {
		const res = await app.request(`${API}/v1/commute/plans`);
		expect(res.status).toBe(401);
		const preflight = await app.request(`${API}/v1/commute/plans`, {
			headers: {
				"access-control-request-headers": "x-betro-install,authorization",
				"access-control-request-method": "GET",
				origin: LOCAL_ORIGIN,
			},
			method: "OPTIONS",
		});
		expect(
			preflight.headers.get("access-control-allow-headers")?.toLowerCase()
		).toContain("x-betro-install");
	});

	test("rpc healthCheck works", async () => {
		const { status, json } = await callRpc("healthCheck");
		expect(status).toBe(200);
		expect(json).toBe("OK");
	});

	test("privateData requires a session", async () => {
		const anonymous = await callRpc("privateData");
		expect(anonymous.status).toBe(401);
		expect((anonymous.json as { code: string }).code).toBe("UNAUTHORIZED");

		const email = "rider@example.com";
		const signUp = await app.request(`${API}/api/auth/sign-up/email`, {
			body: JSON.stringify({ email, name: "Rider", password: "password-1234" }),
			headers: { "content-type": "application/json", origin: LOCAL_ORIGIN },
			method: "POST",
		});
		expect(signUp.status).toBe(200);
		const cookie = cookieHeader(signUp);
		expect(cookie).not.toBe("");

		const signedIn = await callRpc("privateData", { cookie });
		expect(signedIn.status).toBe(200);
		expect((signedIn.json as { user: { email: string } }).user.email).toBe(
			email
		);
	});

	test("status paths are not served on api host", async () => {
		const statusOnApi = await app.request(`${API}/status.json`);
		expect(statusOnApi.status).toBe(404);

		const rpcOnStatus = await app.request(`${STATUS}/rpc/healthCheck`, {
			body: JSON.stringify({}),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		expect(rpcOnStatus.status).toBe(404);
	});

	test("collector routes answer 503 without a collector", async () => {
		const snapshot = await app.request(`${API}/v1/snapshot/subway`);
		expect(snapshot.status).toBe(503);

		const unknownKind = await app.request(`${API}/v1/snapshot/tram`);
		expect(unknownKind.status).toBe(404);

		const status = await app.request(`${STATUS}/status.json`);
		expect(status.status).toBe(503);
	});

	test("cors allows configured origin only", async () => {
		const preflight = (origin: string) =>
			app.request(`${API}/rpc/healthCheck`, {
				headers: {
					"access-control-request-headers": "content-type",
					"access-control-request-method": "POST",
					origin,
				},
				method: "OPTIONS",
			});

		const allowed = await preflight(LOCAL_ORIGIN);
		expect(allowed.headers.get("access-control-allow-origin")).toBe(
			LOCAL_ORIGIN
		);
		expect(allowed.headers.get("access-control-allow-credentials")).toBe(
			"true"
		);
		expect(allowed.headers.get("access-control-max-age")).toBe("86400");

		const denied = await preflight("https://evil.example");
		expect(denied.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("serves snapshot with etag and 304", async () => {
		const etag = `"${SNAPSHOT_ETAG}-subway"`;
		const first = await appWithCollector.request(`${API}/v1/snapshot/subway`);
		expect(first.status).toBe(200);
		expect(first.headers.get("etag")).toBe(etag);
		expect(first.headers.get("cache-control")).toBe("public, max-age=10");
		expect(first.headers.get("content-type")).toContain("application/json");
		expect(await first.text()).toBe(SNAPSHOT_BODY);

		const conditional = (value: string) =>
			appWithCollector.request(`${API}/v1/snapshot/subway`, {
				headers: { "if-none-match": value },
			});
		const notModified = await Promise.all(
			[etag, `W/${etag}`, `"other", ${etag}`, "*"].map(conditional)
		);
		for (const res of notModified) {
			expect(res.status).toBe(304);
			expect(res.headers.get("etag")).toBe(etag);
			expect(res.body).toBeNull();
		}
		const changed = await conditional(`"${SNAPSHOT_ETAG}-bus"`);
		expect(changed.status).toBe(200);

		const bus = await appWithCollector.request(`${API}/v1/snapshot/bus`);
		expect(bus.headers.get("etag")).toBe(`"${SNAPSHOT_ETAG}-bus"`);
		const unknown = await appWithCollector.request(`${API}/v1/snapshot/tram`);
		expect(unknown.status).toBe(404);
	});

	test("status page only on status host", async () => {
		const page = await appWithCollector.request(`${STATUS}/`);
		expect(page.status).toBe(200);
		expect(page.headers.get("content-type")).toContain("text/html");
		expect(page.headers.get("cache-control")).toBe("no-store");
		const html = await page.text();
		expect(html).toContain("수집 상태 <strong>정상</strong>");
		expect(html).not.toContain("<script");

		const json = await appWithCollector.request(`${STATUS}/status.json`);
		expect(json.status).toBe(200);
		expect(json.headers.get("cache-control")).toBe("no-store");
		expect(((await json.json()) as CollectorStatus).generatedAt).toBe(
			STATUS_AT
		);

		// API 호스트의 "/"는 상태 페이지가 아니라 헬스 체크다.
		const apiRoot = await appWithCollector.request(`${API}/`);
		expect(await apiRoot.text()).toBe("OK");
		const statusOnApi = await appWithCollector.request(`${API}/status.json`);
		expect(statusOnApi.status).toBe(404);
		// 상태 호스트에는 스냅샷이 없다.
		const snapshotOnStatus = await appWithCollector.request(
			`${STATUS}/v1/snapshot/subway`
		);
		expect(snapshotOnStatus.status).toBe(404);
	});

	test("collector start only on status host via POST", async () => {
		const before = collectorCalls.start;
		const onApi = await appWithCollector.request(
			`${API}/internal/collector/start`,
			{ method: "POST" }
		);
		expect(onApi.status).toBe(404);
		const viaGet = await appWithCollector.request(
			`${STATUS}/internal/collector/start`
		);
		expect(viaGet.status).toBe(404);
		expect(collectorCalls.start).toBe(before);

		const started = await appWithCollector.request(
			`${STATUS}/internal/collector/start`,
			{ method: "POST" }
		);
		expect(started.status).toBe(200);
		expect(await started.json()).toEqual({
			alarmAt: STATUS_AT,
			alreadyRunning: false,
		});
		expect(collectorCalls.start).toBe(before + 1);
	});
});

describe("ifNoneMatchMatches", () => {
	test("handles lists, weak tags and wildcard", () => {
		expect(ifNoneMatchMatches(undefined, '"a"')).toBe(false);
		expect(ifNoneMatchMatches("", '"a"')).toBe(false);
		expect(ifNoneMatchMatches('"a"', '"a"')).toBe(true);
		expect(ifNoneMatchMatches('W/"a"', '"a"')).toBe(true);
		expect(ifNoneMatchMatches(' "b" , W/"a" ', '"a"')).toBe(true);
		expect(ifNoneMatchMatches('"b", "c"', '"a"')).toBe(false);
		expect(ifNoneMatchMatches("*", '"a"')).toBe(true);
		expect(ifNoneMatchMatches("a", '"a"')).toBe(false);
	});
});

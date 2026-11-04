import { createAuth } from "@Betro/auth";
import { createTestDb } from "@Betro/db/test-db";
import { beforeAll, describe, expect, test } from "bun:test";

import { createApp } from "./app";

const API_HOST = "betro.cmu02-studio.com";
const STATUS_HOST = "betro-status.cmu02-studio.com";
const API = `https://${API_HOST}`;
const STATUS = `https://${STATUS_HOST}`;
const LOCAL_ORIGIN = "http://localhost:8081";
const TEST_SECRET = "test-secret-test-secret-test-secret-0123";

type App = ReturnType<typeof createApp>;

let app: App;

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
});

import { expect, it } from "bun:test";

import type { ServerClient } from "../server/api-client";
import { handleCommuteAction, registerFcmToken } from "./handle-commute-action";

function client(status: number, seen: unknown[] = []): ServerClient {
	return {
		request: (method, path, body) => {
			seen.push({ body, method, path });
			return Promise.resolve({ json: null, status });
		},
	};
}

it("sends the end input and clears the notification on 204", async () => {
	const seen: unknown[] = [];
	const ended: string[] = [];

	const ok = await handleCommuteAction(
		{ kind: "end", sessionId: "session-1" },
		{ client: client(204, seen), notifier: { end: (id) => ended.push(id) } }
	);

	expect(ok).toBe(true);
	expect(seen).toEqual([
		{
			body: { kind: "end" },
			method: "POST",
			path: "/v1/commute/sessions/session-1/input",
		},
	]);
	expect(ended).toEqual(["session-1"]);
});

it("keeps the notification when the server or the network fails", async () => {
	const ended: string[] = [];
	const notifier = { end: (id: string) => ended.push(id) };

	expect(
		await handleCommuteAction(
			{ kind: "end", sessionId: "s" },
			{ client: client(500), notifier }
		)
	).toBe(false);
	expect(
		await handleCommuteAction(
			{ kind: "end", sessionId: "s" },
			{ client: client(0), notifier }
		)
	).toBe(false);
	expect(ended).toEqual([]);
});

it("registers the FCM token as kind fcm", async () => {
	const seen: unknown[] = [];

	expect(await registerFcmToken(client(204, seen), "token-value")).toBe(true);
	expect(seen).toEqual([
		{
			body: { env: "production", kind: "fcm", token: "token-value" },
			method: "PUT",
			path: "/v1/push-tokens",
		},
	]);
	expect(await registerFcmToken(client(500), "token-value")).toBe(false);
});

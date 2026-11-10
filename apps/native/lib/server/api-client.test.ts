import { expect, it } from "bun:test";

import { createServerClient } from "./api-client";

const IDENTITY = { installId: "install-1", secret: "secret-1" };

interface Call {
	init: RequestInit;
	url: string;
}

function recordingFetch(respond: () => Response | Promise<Response>): {
	calls: Call[];
	fetch: typeof fetch;
} {
	const calls: Call[] = [];
	const fake = ((url: string, init: RequestInit) => {
		calls.push({ init, url });
		return Promise.resolve(respond());
	}) as unknown as typeof fetch;
	return { calls, fetch: fake };
}

function clientWith(fetchFn: typeof fetch, baseUrl = "https://api.test") {
	return createServerClient({
		baseUrl,
		fetch: fetchFn,
		identity: () => Promise.resolve(IDENTITY),
	});
}

it("attaches both auth headers and a JSON body", async () => {
	const { calls, fetch: fetchFn } = recordingFetch(
		() => new Response(JSON.stringify({ ok: true }), { status: 201 })
	);
	const result = await clientWith(fetchFn).request("POST", "/v1/x", { a: 1 });

	expect(result).toEqual({ json: { ok: true }, status: 201 });
	const headers = new Headers(calls[0]?.init.headers);
	expect(headers.get("X-Betro-Install")).toBe("install-1");
	expect(headers.get("Authorization")).toBe("Bearer secret-1");
	expect(headers.get("Content-Type")).toBe("application/json");
	expect(calls[0]?.init.method).toBe("POST");
	expect(calls[0]?.init.body).toBe(JSON.stringify({ a: 1 }));
});

it("joins the base url and path with exactly one slash", async () => {
	const { calls, fetch: fetchFn } = recordingFetch(
		() => new Response("{}", { status: 200 })
	);
	await clientWith(fetchFn, "https://api.test/").request("GET", "/v1/x");
	await clientWith(fetchFn, "https://api.test").request("GET", "v1/y");
	await clientWith(fetchFn, "https://api.test//").request("GET", "//v1/z");

	expect(calls.map((call) => call.url)).toEqual([
		"https://api.test/v1/x",
		"https://api.test/v1/y",
		"https://api.test/v1/z",
	]);
});

it("sends no body for a request without one", async () => {
	const { calls, fetch: fetchFn } = recordingFetch(
		() => new Response(null, { status: 204 })
	);
	const result = await clientWith(fetchFn).request("DELETE", "/v1/installs/me");

	expect(result).toEqual({ json: null, status: 204 });
	expect(calls[0]?.init.body).toBeUndefined();
});

it("returns status 0 instead of throwing when fetch fails", async () => {
	const fetchFn = (() => Promise.reject(new Error("offline"))) as typeof fetch;
	const result = await clientWith(fetchFn).request("GET", "/v1/x");

	expect(result).toEqual({ json: null, status: 0 });
});

it("returns status 0 when the identity cannot be read", async () => {
	const { fetch: fetchFn } = recordingFetch(() => new Response("{}"));
	const client = createServerClient({
		baseUrl: "https://api.test",
		fetch: fetchFn,
		identity: () => Promise.reject(new Error("locked")),
	});

	expect(await client.request("GET", "/v1/x")).toEqual({
		json: null,
		status: 0,
	});
});

it("returns null json for a body that is not JSON", async () => {
	const { fetch: fetchFn } = recordingFetch(
		() => new Response("<html>bad gateway</html>", { status: 502 })
	);
	const result = await clientWith(fetchFn).request("GET", "/v1/x");

	expect(result).toEqual({ json: null, status: 502 });
});

it("aborts a request that takes longer than 10 seconds", async () => {
	let signal: AbortSignal | null | undefined;
	const fetchFn = ((_url: string, init: RequestInit) => {
		({ signal } = init);
		return new Promise<Response>((_resolve, reject) => {
			init.signal?.addEventListener("abort", () => reject(new Error("abort")));
		});
	}) as unknown as typeof fetch;
	const originalSetTimeout = globalThis.setTimeout;
	let delay = -1;
	globalThis.setTimeout = ((fn: () => void, ms: number) => {
		delay = ms;
		return originalSetTimeout(fn, 0);
	}) as unknown as typeof setTimeout;
	try {
		const result = await clientWith(fetchFn).request("GET", "/v1/x");
		expect(result).toEqual({ json: null, status: 0 });
		expect(delay).toBe(10_000);
		expect(signal?.aborted).toBe(true);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}
});

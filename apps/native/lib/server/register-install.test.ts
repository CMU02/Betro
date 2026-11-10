import { expect, it } from "bun:test";

import type { ServerClient } from "./api-client";
import { registerInstall, withRegistrationReset } from "./register-install";

const IDENTITY = { installId: "install-1", secret: "plain-secret-value" };
const SERVER_URL = "https://api.test";
const MARKER = "https://api.test|install-1";

function memoryStore(initial: string | null = null) {
	let value = initial;
	return {
		get: () => Promise.resolve(value),
		peek: () => value,
		set: (next: string) => {
			value = next;
			return Promise.resolve();
		},
	};
}

function fakeClient(status: number) {
	const bodies: unknown[] = [];
	const paths: string[] = [];
	const client: ServerClient = {
		request: (_method, path, body) => {
			paths.push(path);
			bodies.push(body);
			return Promise.resolve({ json: null, status });
		},
	};
	return { bodies, client, paths };
}

const HASHED = "a1b2c3";
const hash = (_text: string) => Promise.resolve(HASHED);

function run(
	client: ServerClient,
	store: ReturnType<typeof memoryStore>,
	platform: "ios" | "android" = "ios",
	serverUrl = SERVER_URL
) {
	return registerInstall({
		client,
		hash,
		identity: IDENTITY,
		platform,
		serverUrl,
		store,
	});
}

it("registers on 201 and remembers the server and install id", async () => {
	const { client, bodies, paths } = fakeClient(201);
	const store = memoryStore();

	expect(await run(client, store, "android")).toBe("registered");
	expect(paths).toEqual(["/v1/installs"]);
	expect(bodies[0]).toEqual({
		installId: "install-1",
		platform: "android",
		secretHash: HASHED,
	});
	expect(store.peek()).toBe(MARKER);
});

it("treats 200 as registered too", async () => {
	const { client } = fakeClient(200);
	const store = memoryStore();

	expect(await run(client, store)).toBe("registered");
	expect(store.peek()).toBe(MARKER);
});

it("does not call the server again once registered", async () => {
	const { client, paths } = fakeClient(201);
	const store = memoryStore();

	await run(client, store);
	expect(await run(client, store)).toBe("already");
	expect(paths).toHaveLength(1);
});

it("registers again when the stored id belongs to another install", async () => {
	const { client, paths } = fakeClient(201);
	const store = memoryStore("https://api.test|old-install");

	expect(await run(client, store)).toBe("registered");
	expect(paths).toHaveLength(1);
	expect(store.peek()).toBe(MARKER);
});

it("reports a conflict on 409 and stores nothing", async () => {
	const { client } = fakeClient(409);
	const store = memoryStore();

	expect(await run(client, store)).toBe("conflict");
	expect(store.peek()).toBeNull();
});

it("reports offline on a network error and retries next time", async () => {
	const offline = fakeClient(0);
	const store = memoryStore();

	expect(await run(offline.client, store)).toBe("offline");
	expect(store.peek()).toBeNull();

	const online = fakeClient(201);
	expect(await run(online.client, store)).toBe("registered");
	expect(online.paths).toHaveLength(1);
});

it("reports offline for other failures without storing", async () => {
	const { client } = fakeClient(500);
	const store = memoryStore();

	expect(await run(client, store)).toBe("offline");
	expect(store.peek()).toBeNull();
});

it("never sends the secret itself", async () => {
	const { client, bodies } = fakeClient(201);
	await run(client, memoryStore());

	expect(JSON.stringify(bodies)).not.toContain("plain-secret-value");
});

it("registers again with a server it has not registered with", async () => {
	const { client, paths } = fakeClient(201);
	const store = memoryStore(MARKER);

	expect(await run(client, store, "ios", "https://other.test/")).toBe(
		"registered"
	);
	expect(paths).toHaveLength(1);
	expect(store.peek()).toBe("https://other.test|install-1");
});

it("ignores trailing slashes when comparing the server", async () => {
	const { client, paths } = fakeClient(201);
	const store = memoryStore(MARKER);

	expect(await run(client, store, "ios", "https://api.test//")).toBe("already");
	expect(paths).toHaveLength(0);
});

it("registers again over a marker that holds only the install id", async () => {
	const { client, paths } = fakeClient(201);
	const store = memoryStore("install-1");

	expect(await run(client, store)).toBe("registered");
	expect(paths).toHaveLength(1);
});

function clientReturning(statuses: number[]): ServerClient {
	let index = 0;
	return {
		request: () => {
			const status = statuses[index] ?? 200;
			index += 1;
			return Promise.resolve({ json: null, status });
		},
	};
}

it("forgets the registration when the server answers 401", async () => {
	let cleared = 0;
	const client = withRegistrationReset(clientReturning([200, 401]), () => {
		cleared += 1;
		return Promise.resolve();
	});

	expect((await client.request("GET", "/v1/x")).status).toBe(200);
	expect(cleared).toBe(0);
	expect((await client.request("PUT", "/v1/push-tokens", {})).status).toBe(401);
	expect(cleared).toBe(1);
});

it("keeps the registration on other failures", async () => {
	let cleared = 0;
	const client = withRegistrationReset(clientReturning([0, 403, 500]), () => {
		cleared += 1;
		return Promise.resolve();
	});

	await client.request("GET", "/v1/x");
	await client.request("GET", "/v1/x");
	await client.request("GET", "/v1/x");
	expect(cleared).toBe(0);
});

it("still returns the 401 when clearing the marker fails", async () => {
	const client = withRegistrationReset(clientReturning([401]), () =>
		Promise.reject(new Error("storage"))
	);

	expect(await client.request("GET", "/v1/x")).toEqual({
		json: null,
		status: 401,
	});
});

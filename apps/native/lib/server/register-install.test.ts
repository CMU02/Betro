import { expect, it } from "bun:test";

import type { ServerClient } from "./api-client";
import { registerInstall } from "./register-install";

const IDENTITY = { installId: "install-1", secret: "plain-secret-value" };

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
	platform: "ios" | "android" = "ios"
) {
	return registerInstall({ client, hash, identity: IDENTITY, platform, store });
}

it("registers on 201 and remembers the install id", async () => {
	const { client, bodies, paths } = fakeClient(201);
	const store = memoryStore();

	expect(await run(client, store, "android")).toBe("registered");
	expect(paths).toEqual(["/v1/installs"]);
	expect(bodies[0]).toEqual({
		installId: "install-1",
		platform: "android",
		secretHash: HASHED,
	});
	expect(store.peek()).toBe("install-1");
});

it("treats 200 as registered too", async () => {
	const { client } = fakeClient(200);
	const store = memoryStore();

	expect(await run(client, store)).toBe("registered");
	expect(store.peek()).toBe("install-1");
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
	const store = memoryStore("old-install");

	expect(await run(client, store)).toBe("registered");
	expect(paths).toHaveLength(1);
	expect(store.peek()).toBe("install-1");
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

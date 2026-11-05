import { expect, it } from "bun:test";

import {
	getOrCreateInstallIdentity,
	INSTALL_ID_KEY,
	INSTALL_SECRET_KEY,
	type SecureKeyValue,
} from "./install-identity";

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const random = {
	bytes: (n: number) => new Uint8Array(n).fill(7),
	uuid: () => "11111111-1111-4111-8111-111111111111",
};

function memorySecureStore(
	initial: Record<string, string> = {}
): SecureKeyValue {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (k) => Promise.resolve(map.get(k) ?? null),
		setItem: (k, v) => {
			map.set(k, v);
			return Promise.resolve();
		},
	};
}

it("creates and stores both values on first run", async () => {
	const store = memorySecureStore();
	const id = await getOrCreateInstallIdentity(store, random);
	expect(id.installId).toBe("11111111-1111-4111-8111-111111111111");
	expect(id.secret).toMatch(SECRET_PATTERN);
	expect(
		await getOrCreateInstallIdentity(store, {
			bytes: random.bytes,
			uuid: () => "other",
		})
	).toEqual(id);
});

it("regenerates both when only one value is stored", async () => {
	const store = memorySecureStore({ [INSTALL_ID_KEY]: "stale-id" });
	const id = await getOrCreateInstallIdentity(store, random);
	expect(id.installId).toBe("11111111-1111-4111-8111-111111111111");
	expect(await store.getItem(INSTALL_SECRET_KEY)).toBe(id.secret);
});

it("propagates storage errors instead of returning a partial identity", async () => {
	const failing: SecureKeyValue = {
		getItem: () => Promise.reject(new Error("keychain locked")),
		setItem: () => Promise.resolve(),
	};
	await expect(getOrCreateInstallIdentity(failing, random)).rejects.toThrow(
		"keychain locked"
	);
});

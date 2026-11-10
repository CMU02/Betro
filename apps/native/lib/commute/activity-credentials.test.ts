import { expect, test } from "bun:test";

import {
	type ActivityCredentials,
	passActivityCredentials,
} from "./activity-credentials";

const IDENTITY = { installId: "install-1", secret: "secret-1" };

function recorder() {
	const calls: ActivityCredentials[] = [];
	return {
		calls,
		setCredentials: (input: ActivityCredentials) => {
			calls.push(input);
			return Promise.resolve();
		},
	};
}

test("iOS hands the install identity and server URL to the native module", async () => {
	const native = recorder();
	const result = await passActivityCredentials({
		identity: IDENTITY,
		platform: "ios",
		serverUrl: "https://api.example.test",
		setCredentials: native.setCredentials,
	});
	expect(result).toBe("passed");
	expect(native.calls).toEqual([
		{
			installId: "install-1",
			secret: "secret-1",
			serverUrl: "https://api.example.test",
		},
	]);
});

test("Android does not call the native module", async () => {
	const native = recorder();
	const result = await passActivityCredentials({
		identity: IDENTITY,
		platform: "android",
		serverUrl: "https://api.example.test",
		setCredentials: native.setCredentials,
	});
	expect(result).toBe("skipped");
	expect(native.calls).toEqual([]);
});

test("an empty server URL is not stored", async () => {
	const native = recorder();
	const result = await passActivityCredentials({
		identity: IDENTITY,
		platform: "ios",
		serverUrl: "  ",
		setCredentials: native.setCredentials,
	});
	expect(result).toBe("skipped");
	expect(native.calls).toEqual([]);
});

test("trailing slashes are removed from the server URL", async () => {
	const native = recorder();
	await passActivityCredentials({
		identity: IDENTITY,
		platform: "ios",
		serverUrl: "https://api.example.test//",
		setCredentials: native.setCredentials,
	});
	expect(native.calls[0]?.serverUrl).toBe("https://api.example.test");
});

test("a native failure rejects so the caller can report it", async () => {
	const failure = new Error("keychain unavailable");
	await expect(
		passActivityCredentials({
			identity: IDENTITY,
			platform: "ios",
			serverUrl: "https://api.example.test",
			setCredentials: () => Promise.reject(failure),
		})
	).rejects.toBe(failure);
});

import { expect, it } from "bun:test";

import type { RegisterResult } from "./register-install";
import { createRegistrationFlow } from "./registration-flow";

function sequence(results: (RegisterResult | "error")[]) {
	let calls = 0;
	return {
		calls: () => calls,
		register: () => {
			const result = results[calls] ?? "error";
			calls += 1;
			return Promise.resolve(result);
		},
	};
}

it("passes credentials after a successful registration", async () => {
	const register = sequence(["registered"]);
	let passed = 0;
	const flow = createRegistrationFlow({
		onRegistered: () => {
			passed += 1;
			return Promise.resolve();
		},
		register: register.register,
	});

	expect(await flow.run()).toBe(true);
	expect(passed).toBe(1);
});

it("passes credentials when the install was already registered", async () => {
	let passed = 0;
	const flow = createRegistrationFlow({
		onRegistered: () => {
			passed += 1;
			return Promise.resolve();
		},
		register: sequence(["already"]).register,
	});

	expect(await flow.run()).toBe(true);
	expect(passed).toBe(1);
});

for (const failure of ["offline", "conflict", "error"] as const) {
	it(`does not pass credentials when registration is ${failure}`, async () => {
		let passed = 0;
		const flow = createRegistrationFlow({
			onRegistered: () => {
				passed += 1;
				return Promise.resolve();
			},
			register: sequence([failure]).register,
		});

		expect(await flow.run()).toBe(false);
		expect(passed).toBe(0);
	});
}

it("tries again on the next run until it succeeds, then stops", async () => {
	const register = sequence(["offline", "registered"]);
	let passed = 0;
	const flow = createRegistrationFlow({
		onRegistered: () => {
			passed += 1;
			return Promise.resolve();
		},
		register: register.register,
	});

	expect(await flow.run()).toBe(false);
	expect(await flow.run()).toBe(true);
	expect(await flow.run()).toBe(true);
	expect(register.calls()).toBe(2);
	expect(passed).toBe(1);
});

it("tries again when passing the credentials fails", async () => {
	const register = sequence(["registered", "already"]);
	let attempts = 0;
	const flow = createRegistrationFlow({
		onRegistered: () => {
			attempts += 1;
			return attempts === 1
				? Promise.reject(new Error("keychain"))
				: Promise.resolve();
		},
		register: register.register,
	});

	expect(await flow.run()).toBe(false);
	expect(await flow.run()).toBe(true);
	expect(attempts).toBe(2);
});

it("shares one attempt between overlapping runs", async () => {
	const register = sequence(["registered"]);
	const flow = createRegistrationFlow({
		onRegistered: () => Promise.resolve(),
		register: register.register,
	});

	const [first, second] = await Promise.all([flow.run(), flow.run()]);
	expect(first).toBe(true);
	expect(second).toBe(true);
	expect(register.calls()).toBe(1);
});

import { expect, it } from "bun:test";

import { permissionStepFor, subscribeOptionsForLaunch } from "./push-launch";

it("never asks for notification permission when the app launches", () => {
	expect(subscribeOptionsForLaunch()).toEqual({ requestPermission: false });
	expect(permissionStepFor(subscribeOptionsForLaunch())).toBe("check");
});

it("asks only when the caller explicitly requests permission", () => {
	expect(permissionStepFor({ requestPermission: true })).toBe("request");
	expect(permissionStepFor({ requestPermission: false })).toBe("check");
});

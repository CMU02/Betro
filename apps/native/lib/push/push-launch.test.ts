import { expect, it } from "bun:test";

import {
	permissionStepFor,
	shouldRetryPushSetup,
	subscribeOptionsForLaunch,
} from "./push-launch";

it("never asks for notification permission when the app launches", () => {
	expect(subscribeOptionsForLaunch()).toEqual({ requestPermission: false });
	expect(permissionStepFor(subscribeOptionsForLaunch())).toBe("check");
});

it("asks only when the caller explicitly requests permission", () => {
	expect(permissionStepFor({ requestPermission: true })).toBe("request");
	expect(permissionStepFor({ requestPermission: false })).toBe("check");
});

it("sets push up again once permission is granted after a refusal", () => {
	expect(shouldRetryPushSetup("denied", "granted")).toBe(true);
});

it("does not set push up again while it is checking, running, failed or still refused", () => {
	expect(shouldRetryPushSetup("checking", "granted")).toBe(false);
	expect(shouldRetryPushSetup("granted", "granted")).toBe(false);
	expect(shouldRetryPushSetup("denied", "denied")).toBe(false);
	expect(shouldRetryPushSetup("denied", null)).toBe(false);
	expect(shouldRetryPushSetup("error", "granted")).toBe(false);
});

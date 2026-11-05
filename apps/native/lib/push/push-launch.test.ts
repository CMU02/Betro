import { expect, it } from "bun:test";

import { subscribeOptionsForLaunch } from "./push-launch";

it("never asks for notification permission when the app launches", () => {
	expect(subscribeOptionsForLaunch()).toEqual({ requestPermission: false });
});

import { expect, it } from "bun:test";

import { canOpenNow, OPEN_LOCK_MS } from "./open-lock";

const OPENED_AT = 10_000;

it("opens when nothing was opened yet", () => {
	expect(canOpenNow(null, OPENED_AT)).toBe(true);
});

it("ignores a second tap that comes before the lock runs out", () => {
	expect(canOpenNow(OPENED_AT, OPENED_AT)).toBe(false);
	expect(canOpenNow(OPENED_AT, OPENED_AT + OPEN_LOCK_MS - 1)).toBe(false);
});

it("opens again once the lock has run out", () => {
	expect(canOpenNow(OPENED_AT, OPENED_AT + OPEN_LOCK_MS)).toBe(true);
});

it("opens when the clock went back so a moved clock cannot lock it for long", () => {
	expect(canOpenNow(OPENED_AT, OPENED_AT - 1)).toBe(true);
});

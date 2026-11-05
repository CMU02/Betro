import { expect, it } from "bun:test";

import { withAlpha } from "./tokens";

it("appends an alpha channel to a six-digit token", () => {
	expect(withAlpha("accent/primary", "dark", 0.55)).toBe("#c6f4328c");
	expect(withAlpha("accent/primary", "dark", 1)).toBe("#c6f432ff");
	expect(withAlpha("accent/primary", "dark", 0)).toBe("#c6f43200");
});

it("refuses tokens that already carry alpha", () => {
	expect(() => withAlpha("bg/glass", "dark", 0.5)).toThrow("bg/glass");
});

it("refuses opacity outside 0 to 1", () => {
	expect(() => withAlpha("accent/primary", "dark", 1.2)).toThrow();
	expect(() => withAlpha("accent/primary", "dark", -0.1)).toThrow();
});

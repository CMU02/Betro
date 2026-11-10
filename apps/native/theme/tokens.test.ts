import { expect, it } from "bun:test";

import { colorToken, RADII, withAlpha } from "./tokens";

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

it("tracks the 2026-11-10 Figma values", () => {
	expect(colorToken("bg/inverse", "dark")).toBe("#f6f6f7");
	expect(colorToken("bg/inverse", "light")).toBe("#0e0f10");
	expect(colorToken("text/tertiary", "dark")).toBe("#90939a");
	expect(colorToken("status/live", "light")).toBe("#0b7a3e");
	expect(RADII.lg).toBe(12);
	expect(RADII.md).toBe(10);
	expect(RADII.xl).toBe(16);
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderThemeCss } from "./render-theme-css";
import { COLOR_TOKENS, colorToken } from "./tokens";

describe("renderThemeCss", () => {
	const css = renderThemeCss();
	const block = (variant: "dark" | "light") => {
		const start = css.indexOf(`@variant ${variant} {`);
		return css.slice(start, css.indexOf("}", start));
	};

	it("writes every color token into both variants", () => {
		expect(block("dark")).toContain("--color-bg-canvas: #0b0e15;");
		expect(block("light")).toContain("--color-bg-canvas: #f5f6f8;");
		expect(block("light")).toContain("--color-text-accent: #4f6a08;");
		for (const name of Object.keys(COLOR_TOKENS)) {
			expect(block("dark")).toContain(`--color-${name.replace("/", "-")}:`);
		}
	});

	it("maps HeroUI variables to Betro tokens", () => {
		expect(block("dark")).toContain("--accent: #c6f432;");
		expect(block("dark")).toContain("--accent-foreground: #0b0e15;");
		expect(block("light")).toContain("--background: #f5f6f8;");
		expect(block("dark")).toContain("--danger: #ff6b6b;");
	});

	it("writes transit colors and radii once, outside variants", () => {
		expect(css).toContain("--color-transit-line-2: #00a84d;");
		expect(css).toContain("--color-transit-bus-trunk: #0068b7;");
		expect(css).toContain("--radius-2xl: 28px;");
	});

	it("matches the committed generated file", () => {
		const file = readFileSync(
			join(import.meta.dir, "theme.generated.css"),
			"utf8"
		);
		expect(file).toBe(css);
	});
});

describe("colorToken", () => {
	it("returns the value for the requested mode", () => {
		expect(colorToken("accent/soft", "dark")).toBe("#26330a");
		expect(colorToken("accent/soft", "light")).toBe("#f0fbc8");
	});
});

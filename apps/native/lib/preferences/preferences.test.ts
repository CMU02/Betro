import { expect, it } from "bun:test";

import {
	DEFAULT_PREFERENCES,
	parsePreferences,
	toUniwindTheme,
} from "./preferences";

it("returns defaults for missing or broken data", () => {
	expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
	expect(parsePreferences("{not json")).toEqual(DEFAULT_PREFERENCES);
	expect(parsePreferences(JSON.stringify({ version: 99 }))).toEqual(
		DEFAULT_PREFERENCES
	);
});

it("keeps valid fields and replaces invalid ones", () => {
	const raw = JSON.stringify({
		dataSaver: "yes",
		onboardingCompleted: true,
		themeMode: "dark",
		version: 1,
	});
	expect(parsePreferences(raw)).toEqual({
		...DEFAULT_PREFERENCES,
		onboardingCompleted: true,
		themeMode: "dark",
	});
});

it("passes the saved theme straight to Uniwind", () => {
	expect(toUniwindTheme("system")).toBe("system");
	expect(toUniwindTheme("light")).toBe("light");
});

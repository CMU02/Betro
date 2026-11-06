import { expect, it } from "bun:test";

import { TABS } from "./tabs";

it("lists the four MVP tabs in order", () => {
	expect(TABS.map((t) => t.label)).toEqual([
		"지도",
		"즐겨찾기",
		"출퇴근",
		"설정",
	]);
	expect(TABS.map((t) => t.name)).toEqual([
		"index",
		"favorites",
		"commute",
		"settings",
	]);
});

it("pairs each tab with its Lucide icon name", () => {
	expect(TABS.map((t) => t.icon)).toEqual(["map", "star", "route", "settings"]);
});

import { expect, it } from "bun:test";

import { t } from "@/lib/i18n/t";
import { TABS } from "./tabs";

it("lists the four MVP tabs in order", () => {
	expect(TABS.map((tab) => t(tab.labelKey))).toEqual([
		"지도",
		"즐겨찾기",
		"출퇴근",
		"설정",
	]);
	expect(TABS.map((tab) => tab.name)).toEqual([
		"index",
		"favorites",
		"commute",
		"settings",
	]);
});

it("pairs each tab with its Lucide icon name", () => {
	expect(TABS.map((tab) => tab.icon)).toEqual([
		"map",
		"star",
		"route",
		"settings",
	]);
});

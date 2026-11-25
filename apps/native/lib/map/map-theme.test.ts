import { describe, expect, test } from "bun:test";

import { mapThemeProps } from "./map-theme";

describe("mapThemeProps", () => {
	test("다크 모드면 야간 모드와 내비 지도를 쓴다", () => {
		expect(mapThemeProps(true)).toEqual({
			isNightModeEnabled: true,
			mapType: "Navi",
		});
	});

	test("라이트 모드면 기본 지도를 쓴다", () => {
		expect(mapThemeProps(false)).toEqual({
			isNightModeEnabled: false,
			mapType: "Basic",
		});
	});
});

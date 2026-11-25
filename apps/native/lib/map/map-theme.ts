/**
 * 네이버 지도의 테마 값. 지도 홈과 상세 화면 지도가 함께 쓴다.
 * 다크 모드에서 밝은 낮 지도가 보이지 않게 야간 모드와 내비 지도를 켠다.
 */
export function mapThemeProps(isDark: boolean): {
	isNightModeEnabled: boolean;
	mapType: "Basic" | "Navi";
} {
	return { isNightModeEnabled: isDark, mapType: isDark ? "Navi" : "Basic" };
}

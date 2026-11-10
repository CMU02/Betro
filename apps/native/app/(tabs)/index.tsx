import { NaverMapView } from "@mj-studio/react-native-naver-map";
import { BottomTabBarHeightContext } from "expo-router/js-tabs";
import { useContext, useMemo } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "@/contexts/app-theme-context";
import { usePreferences } from "@/lib/preferences/use-preferences";

/** 처음 보여줄 곳: 서울시청 부근. 위치 권한과 마지막 위치 기억은 3단계에서 붙인다. */
const INITIAL_CAMERA = {
	latitude: 37.5666,
	longitude: 126.9784,
	zoom: 14,
} as const;

const MAP_STYLE = { flex: 1 } as const;

/**
 * 지도 탭. 지금은 바탕 지도만 그린다. 차량 위치와 노선, 지도 위 조작 UI는 3단계 계획에서 채운다.
 * 네이버 지도의 야간 모드는 `Navi` 유형에서만 동작하므로 다크 테마는 `Navi` + 야간 모드, 라이트는 `Basic`을 쓴다.
 * 지도는 화면 전체에 깔고, 상태 표시줄과 iOS의 떠 있는 탭바만큼 `mapPadding`을 줘서 네이버 로고가 가려지지 않게 한다.
 */
export default function MapTab() {
	const { isDark } = useAppTheme();
	const [preferences] = usePreferences();
	const insets = useSafeAreaInsets();
	const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
	const bottomOverlay = Platform.OS === "ios" ? tabBarHeight : 0;

	const mapPadding = useMemo(
		() => ({ bottom: bottomOverlay, top: insets.top }),
		[bottomOverlay, insets.top]
	);

	return (
		<View className="flex-1 bg-bg-canvas">
			<NaverMapView
				buildingHeight={preferences.show3dBuildings ? 1 : 0}
				initialCamera={INITIAL_CAMERA}
				isExtentBoundedInKorea
				isNightModeEnabled={isDark}
				isShowLocationButton={false}
				isShowZoomControls={false}
				locale="ko"
				mapPadding={mapPadding}
				mapType={isDark ? "Navi" : "Basic"}
				style={MAP_STYLE}
			/>
		</View>
	);
}

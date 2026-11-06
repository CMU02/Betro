import { Stack } from "expo-router";
import { Platform } from "react-native";
import { ScopedTheme } from "uniwind";

import { colorToken } from "@/theme/tokens";

/** 온보딩·권한 화면은 Figma처럼 기기 테마와 상관없이 항상 다크로 그린다. 상태 표시줄·내비게이션 바는 루트 레이아웃이 정한다. */
const SCREEN_OPTIONS = {
	contentStyle: { backgroundColor: colorToken("bg/canvas", "dark") },
	headerShown: false,
	...(Platform.OS === "ios" ? { statusBarStyle: "light" as const } : {}),
} as const;

export default function OnboardingLayout() {
	return (
		<ScopedTheme theme="dark">
			<Stack screenOptions={SCREEN_OPTIONS} />
		</ScopedTheme>
	);
}

import { NavigationBar } from "expo-navigation-bar";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ScopedTheme } from "uniwind";

import { colorToken } from "@/theme/tokens";

/** 온보딩·권한 화면은 Figma처럼 기기 테마와 상관없이 항상 다크로 그린다. */
const SCREEN_OPTIONS = {
	contentStyle: { backgroundColor: colorToken("bg/canvas", "dark") },
	headerShown: false,
} as const;

export default function OnboardingLayout() {
	return (
		<ScopedTheme theme="dark">
			<StatusBar style="light" />
			<NavigationBar style="dark" />
			<Stack screenOptions={SCREEN_OPTIONS} />
		</ScopedTheme>
	);
}

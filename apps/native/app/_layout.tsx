import "@/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Uniwind } from "uniwind";

import { PushNotifications } from "@/components/push-notifications";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { shouldShowOnboarding } from "@/lib/onboarding/onboarding";
import { appPreferences } from "@/lib/preferences/app-preferences";
import { toUniwindTheme } from "@/lib/preferences/preferences";
import { usePreferences } from "@/lib/preferences/use-preferences";
import { queryClient } from "@/utils/orpc";

Uniwind.setTheme(toUniwindTheme(appPreferences.get().themeMode));

const STACK_SCREEN_OPTIONS = { headerShown: false } as const;

/**
 * 온보딩을 끝내기 전에는 온보딩만, 끝낸 뒤에는 탭만 열린다.
 * 푸시는 권한 화면에서 허용한 결과를 바로 쓰도록 온보딩이 끝나면 다시 마운트한다.
 */
function StackLayout() {
	const [preferences] = usePreferences();
	const showOnboarding = shouldShowOnboarding(preferences);
	return (
		<>
			<PushNotifications key={showOnboarding ? "onboarding" : "app"} />
			<Stack screenOptions={STACK_SCREEN_OPTIONS}>
				<Stack.Protected guard={!showOnboarding}>
					<Stack.Screen name="(tabs)" />
					<Stack.Screen name="settings/data-sources" />
				</Stack.Protected>
				<Stack.Protected guard={showOnboarding}>
					<Stack.Screen name="onboarding" />
				</Stack.Protected>
			</Stack>
		</>
	);
}

export default function Layout() {
	return (
		<QueryClientProvider client={queryClient}>
			<GestureHandlerRootView style={{ flex: 1 }}>
				<KeyboardProvider>
					<AppThemeProvider>
						<HeroUINativeProvider>
							<StackLayout />
						</HeroUINativeProvider>
					</AppThemeProvider>
				</KeyboardProvider>
			</GestureHandlerRootView>
		</QueryClientProvider>
	);
}

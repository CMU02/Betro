import "@/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Uniwind } from "uniwind";

import { PushNotifications } from "@/components/push-notifications";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { appPreferences } from "@/lib/preferences/app-preferences";
import { toUniwindTheme } from "@/lib/preferences/preferences";
import { queryClient } from "@/utils/orpc";

Uniwind.setTheme(toUniwindTheme(appPreferences.get().themeMode));

export const unstable_settings = {
	anchor: "(tabs)",
};

const STACK_SCREEN_OPTIONS = { headerShown: false } as const;

function StackLayout() {
	return (
		<Stack screenOptions={STACK_SCREEN_OPTIONS}>
			<Stack.Screen name="(tabs)" />
		</Stack>
	);
}

export default function Layout() {
	return (
		<QueryClientProvider client={queryClient}>
			<GestureHandlerRootView style={{ flex: 1 }}>
				<KeyboardProvider>
					<AppThemeProvider>
						<HeroUINativeProvider>
							<PushNotifications />
							<StackLayout />
						</HeroUINativeProvider>
					</AppThemeProvider>
				</KeyboardProvider>
			</GestureHandlerRootView>
		</QueryClientProvider>
	);
}

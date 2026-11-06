import "@/global.css";
import { wrap } from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { NavigationBar } from "expo-navigation-bar";
import { type ErrorBoundaryProps, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Uniwind } from "uniwind";

import { PushNotifications } from "@/components/push-notifications";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";
import { AppThemeProvider, useAppTheme } from "@/contexts/app-theme-context";
import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import {
	configureCrashReporting,
	reportError,
} from "@/lib/crash/crash-reporting";
import { ensureInstallIdentity } from "@/lib/device/app-install-identity";
import { shouldShowOnboarding } from "@/lib/onboarding/onboarding";
import { appPreferences } from "@/lib/preferences/app-preferences";
import { toUniwindTheme } from "@/lib/preferences/preferences";
import { usePreferences } from "@/lib/preferences/use-preferences";
import { ENV } from "@/src/env";
import { queryClient } from "@/utils/orpc";

Uniwind.setTheme(toUniwindTheme(appPreferences.get().themeMode));
configureCrashReporting(appCrashSink, {
	dsn: ENV.EXPO_PUBLIC_SENTRY_DSN,
	isDev: __DEV__,
});

/**
 * 설치 ID를 읽거나 만든다. 실패하면 기록만 하고 앱은 계속 쓰며, 다음 실행에 다시 시도한다.
 */
async function startInstallIdentity(): Promise<void> {
	try {
		const identity = await ensureInstallIdentity();
		appCrashSink.setInstallId(identity.installId);
		if (__DEV__) {
			// 재실행 뒤에도 같은 값인지 기기 확인에서 본다.
			console.info("[device] installId", identity.installId);
		}
	} catch (error) {
		reportError(appCrashSink, error, "install-identity");
	}
}

startInstallIdentity();

const STACK_SCREEN_OPTIONS = { headerShown: false } as const;

/**
 * 상태 표시줄 글자색과 Android 내비게이션 바 버튼색을 기기 테마가 아니라 앱 테마(다크·라이트 고정 포함)에 맞춘다.
 * Android는 앱 테마를 따로 따라가지 않으므로 명시해야 한다. 온보딩은 자기 StatusBar·NavigationBar로 덮는다.
 * NavigationBar는 Android 밖에서는 아무것도 하지 않는다. `dark`가 "어두운 바 + 밝은 버튼"이다.
 */
function ThemedStatusBar() {
	const { isDark } = useAppTheme();
	return (
		<>
			<StatusBar style={isDark ? "light" : "dark"} />
			<NavigationBar style={isDark ? "dark" : "light"} />
		</>
	);
}

/**
 * 온보딩을 끝내기 전에는 온보딩만, 끝낸 뒤에는 탭만 열린다.
 * 푸시는 권한 화면에서 허용한 결과를 바로 쓰도록 온보딩이 끝나면 다시 마운트한다.
 */
function StackLayout() {
	const [preferences] = usePreferences();
	const showOnboarding = shouldShowOnboarding(preferences);
	return (
		<>
			<ThemedStatusBar />
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

/**
 * 화면에서 처리하지 못한 오류(expo-router). 루트 레이아웃을 대신 그리므로 Provider 없이 그릴 수 있는
 * 컴포넌트만 쓴다.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
	useEffect(() => {
		reportError(appCrashSink, error, "error-boundary");
	}, [error]);
	return (
		<Screen>
			<View className="flex-1 items-center justify-center gap-6 px-6">
				<View className="items-center gap-2">
					<AppText accessibilityRole="header" variant="title2">
						화면을 그리지 못했어요
					</AppText>
					<AppText className="text-center text-text-secondary" variant="bodyM">
						잠시 후 다시 시도해 주세요.
					</AppText>
				</View>
				<AppButton label="다시 시도" onPress={retry} />
			</View>
		</Screen>
	);
}

function Layout() {
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

/** Sentry가 시작되지 않았으면(DSN 없음) 감싸도 아무것도 보내지 않는다. */
export default wrap(Layout);

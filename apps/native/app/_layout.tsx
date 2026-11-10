import "@/global.css";
import { wrap } from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ErrorBoundaryProps, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { useEffect, useMemo } from "react";
import { AppState, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Uniwind } from "uniwind";

import { PushNotifications } from "@/components/push-notifications";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";
import { AppThemeProvider, useAppTheme } from "@/contexts/app-theme-context";
import { passActivityCredentials } from "@/lib/commute/activity-credentials";
import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import {
	configureCrashReporting,
	reportError,
} from "@/lib/crash/crash-reporting";
import { ensureInstallIdentity } from "@/lib/device/app-install-identity";
import { t } from "@/lib/i18n/t";
import { shouldShowOnboarding } from "@/lib/onboarding/onboarding";
import { appPreferences } from "@/lib/preferences/app-preferences";
import { toUniwindTheme } from "@/lib/preferences/preferences";
import { usePreferences } from "@/lib/preferences/use-preferences";
import { ensureRegistered } from "@/lib/server/app-server";
import { createRegistrationFlow } from "@/lib/server/registration-flow";
import { CommuteActivity } from "@/modules/commute-activity";
import { setAndroidSystemBarsContent } from "@/modules/system-bars";
import { ENV } from "@/src/env";
import { queryClient } from "@/utils/orpc";

Uniwind.setTheme(toUniwindTheme(appPreferences.get().themeMode));
configureCrashReporting(appCrashSink, {
	dsn: ENV.EXPO_PUBLIC_SENTRY_DSN,
	isDev: __DEV__,
});

/**
 * 서버가 설치를 안 뒤에만(등록 성공 또는 이미 등록) iOS 네이티브 토큰 보고기와 잠금화면 버튼이 쓸
 * 인증값을 Live Activity 모듈에 넘긴다. 서버가 모르는 설치 ID로 토큰을 보내면 401만 받기 때문이다.
 */
const registration = createRegistrationFlow({
	onRegistered: async () => {
		try {
			await passActivityCredentials({
				identity: await ensureInstallIdentity(),
				platform: Platform.OS,
				serverUrl: ENV.EXPO_PUBLIC_SERVER_URL,
				setCredentials: CommuteActivity.setCredentials,
			});
		} catch (error) {
			reportError(appCrashSink, error, "activity-credentials");
			throw error;
		}
	},
	register: ensureRegistered,
});

/**
 * 설치 ID를 읽거나 만들고 서버에 등록한다. 실패하면 기록만 하고 앱은 계속 쓴다.
 * 등록하지 못했으면 앱이 다시 앞으로 올 때 다시 시도한다(콜드 스타트를 기다리지 않는다).
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
		return;
	}
	await registration.run();
}

startInstallIdentity().catch((error: unknown) => {
	reportError(appCrashSink, error, "install-registration");
});
AppState.addEventListener("change", (state) => {
	if (state === "active") {
		registration.run().catch((error: unknown) => {
			reportError(appCrashSink, error, "install-registration");
		});
	}
});

/**
 * iOS는 Info.plist의 UIViewControllerBasedStatusBarAppearance가 켜져 있어 화면(뷰 컨트롤러)이 상태 표시줄 글자색을 정한다.
 * expo-status-bar 값은 iOS에서 화면이 바뀌면 덮이므로, iOS에서는 내비게이터 옵션으로도 같은 값을 넘긴다.
 * Android는 아래 `SystemBars`만 정한다(react-native-screens 옵션까지 두면 두 쪽이 같은 창 속성을 번갈아 덮는다).
 */
const IS_IOS = Platform.OS === "ios";
const LIGHT_CONTENT_SCREEN_OPTIONS = IS_IOS
	? ({ headerShown: false, statusBarStyle: "light" } as const)
	: ({ headerShown: false } as const);
const DARK_CONTENT_SCREEN_OPTIONS = IS_IOS
	? ({ headerShown: false, statusBarStyle: "dark" } as const)
	: ({ headerShown: false } as const);

/**
 * 상태 표시줄 글자색과 Android 내비게이션 바 버튼색을 기기 테마가 아니라 앱 테마(다크·라이트 고정 포함)에 맞춘다.
 * 온보딩은 테마와 상관없이 다크라서 항상 밝은 글자·버튼을 쓴다. 화면마다 따로 두면 마운트 순서에 따라
 * 앱 테마 값이 온보딩 값을 덮으므로(Android에서 확인), 이 한 곳에서만 정한다.
 * Android는 expo-status-bar·expo-navigation-bar 대신 로컬 모듈로 정한다. 두 라이브러리가 쓰는 androidx 경로는
 * 앱이 백그라운드에서 돌아온 뒤 무시되어 바 색이 고정됐다(modules/system-bars 참고).
 */
function SystemBars({ lightContent }: { lightContent: boolean }) {
	useEffect(() => {
		if (IS_IOS) {
			return;
		}
		setAndroidSystemBarsContent(lightContent).catch((error: unknown) => {
			reportError(appCrashSink, error, "system-bars");
		});
	}, [lightContent]);
	return IS_IOS ? <StatusBar style={lightContent ? "light" : "dark"} /> : null;
}

/**
 * 온보딩을 끝내기 전에는 온보딩만, 끝낸 뒤에는 탭만 열린다.
 * 푸시는 권한 화면에서 허용한 결과를 바로 쓰도록 온보딩이 끝나면 다시 마운트한다.
 */
function StackLayout() {
	const [preferences] = usePreferences();
	const { isDark } = useAppTheme();
	const showOnboarding = shouldShowOnboarding(preferences);
	const lightContent = showOnboarding || isDark;
	const screenOptions = useMemo(
		() =>
			lightContent ? LIGHT_CONTENT_SCREEN_OPTIONS : DARK_CONTENT_SCREEN_OPTIONS,
		[lightContent]
	);
	return (
		<>
			<SystemBars lightContent={lightContent} />
			<PushNotifications key={showOnboarding ? "onboarding" : "app"} />
			<Stack screenOptions={screenOptions}>
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
						{t("errorBoundary.title")}
					</AppText>
					<AppText className="text-center text-text-secondary" variant="bodyM">
						{t("errorBoundary.body")}
					</AppText>
				</View>
				<AppButton label={t("errorBoundary.retry")} onPress={retry} />
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

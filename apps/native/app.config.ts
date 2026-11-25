import type { ExpoConfig } from "expo/config";

// Expo CLI가 app config를 읽기 전에 apps/native/.env를 process.env에 불러온다.
const naverMapClientId = process.env.NAVER_MAP_CLIENT_ID;
if (!naverMapClientId) {
	throw new Error(
		"NAVER_MAP_CLIENT_ID가 없습니다. NCP 콘솔 Maps Application의 Client ID를 apps/native/.env에 넣어주세요."
	);
}

// production 빌드는 크래시를 셀 수 있어야 한다(7.2 ①). DSN 없이 나가지 않게 설정 단계에서 멈춘다.
// 값은 메시지에 담지 않는다.
if (
	process.env.EAS_BUILD_PROFILE === "production" &&
	!process.env.EXPO_PUBLIC_SENTRY_DSN
) {
	throw new Error(
		"EXPO_PUBLIC_SENTRY_DSN가 없습니다. production 빌드는 EAS 환경 변수에 Sentry DSN을 넣어야 합니다."
	);
}

// 이 앱이 보내는 것: Sentry 크래시 보고와 하루 지도 지표, 사용자로 쓰는 설치 ID. 모두 앱 기능용이고 추적에 쓰지 않는다.
const APP_FUNCTIONALITY_DATA = {
	NSPrivacyCollectedDataTypeLinked: false,
	NSPrivacyCollectedDataTypePurposes: [
		"NSPrivacyCollectedDataTypePurposeAppFunctionality",
	],
	NSPrivacyCollectedDataTypeTracking: false,
};

const NAVER_MAP_MAVEN_REPO = "https://repository.map.naver.com/archive/maven";

const config: ExpoConfig = {
	android: {
		adaptiveIcon: {
			backgroundColor: "#0e0f10",
			backgroundImage: "./assets/images/android-icon-background.png",
			foregroundImage: "./assets/images/android-icon-foreground.png",
			monochromeImage: "./assets/images/android-icon-monochrome.png",
		},
		// 쓰지 않는데 라이브러리 매니페스트가 넣는 권한을 뺀다.
		blockedPermissions: [
			"android.permission.READ_EXTERNAL_STORAGE",
			"android.permission.WRITE_EXTERNAL_STORAGE",
			"android.permission.SYSTEM_ALERT_WINDOW",
		],
		// 파일은 git이 무시한다. EAS 원격 빌드에는 파일 환경 변수로만 들어온다.
		googleServicesFile:
			process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
		package: "com.cmu02.betro",
		predictiveBackGestureEnabled: false,
	},
	experiments: {
		reactCompiler: true,
		typedRoutes: true,
	},
	// `eas init`으로 만든 EAS 프로젝트.
	extra: { eas: { projectId: "4119b4df-f46d-4e97-9251-b19bf38a9b9c" } },
	icon: "./assets/images/icon.png",
	ios: {
		appleTeamId: "5JKMP6D4C5",
		bundleIdentifier: "com.cmu02.betro",
		config: {
			usesNonExemptEncryption: false,
		},
		entitlements: {
			"aps-environment": "development",
			// 위젯 확장(targets/commute-activity)과 같은 앱 그룹. 머리줄을 확장에 넘긴다.
			"com.apple.security.application-groups": ["group.com.cmu02.betro"],
		},
		googleServicesFile:
			process.env.GOOGLE_SERVICE_INFO_PLIST ?? "./GoogleService-Info.plist",
		infoPlist: {
			NSSupportsLiveActivities: true,
			NSSupportsLiveActivitiesFrequentUpdates: true,
			UIBackgroundModes: ["remote-notification"],
		},
		// 기존 API 사용 이유(PrivacyInfo.xcprivacy)에 수집 항목을 더한다.
		privacyManifests: {
			NSPrivacyCollectedDataTypes: [
				{
					NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeCrashData",
					...APP_FUNCTIONALITY_DATA,
				},
				{
					NSPrivacyCollectedDataType:
						"NSPrivacyCollectedDataTypeOtherDiagnosticData",
					...APP_FUNCTIONALITY_DATA,
				},
				{
					NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeDeviceID",
					...APP_FUNCTIONALITY_DATA,
				},
			],
		},
		// iPad는 받지 않는다.
		supportsTablet: false,
	},
	// iOS 시작 푸시의 알림 키(commute.start.*)가 앱 번들의 Localizable.strings에서 문구가 된다.
	locales: { ko: "./locales/ko.json" },
	name: "Betro",
	orientation: "portrait",
	plugins: [
		"expo-router",
		["expo-navigation-bar", { enforceContrast: false }],
		[
			"expo-splash-screen",
			{
				backgroundColor: "#f6f6f7",
				dark: {
					backgroundColor: "#0e0f10",
					image: "./assets/images/splash-icon-dark.png",
				},
				image: "./assets/images/splash-icon.png",
				imageWidth: 200,
				resizeMode: "contain",
			},
		],
		"@bacons/apple-targets",
		"@react-native-firebase/app",
		"@react-native-firebase/messaging",
		[
			"expo-location",
			{
				// 사용 중 위치만 쓴다. false면 플러그인이 영어 기본 문구를 넣지 않는다.
				isAndroidBackgroundLocationEnabled: false,
				isIosBackgroundLocationEnabled: false,
				locationAlwaysAndWhenInUsePermission: false,
				locationAlwaysPermission: false,
				locationFullAccuracyPermission: false,
				locationWhenInUsePermission:
					"내 주변 역과 정류장을 바로 보여주기 위해 위치를 사용해요.",
				motionUsagePermission: false,
			},
		],
		[
			"expo-build-properties",
			{
				android: {
					extraMavenRepos: [NAVER_MAP_MAVEN_REPO],
				},
				ios: {
					deploymentTarget: "17.2",
					useFrameworks: "dynamic",
				},
			},
		],
		[
			"expo-font",
			{
				fonts: [
					"./assets/fonts/NotoSansKR-Regular.ttf",
					"./assets/fonts/NotoSansKR-Medium.ttf",
					"./assets/fonts/NotoSansKR-Bold.ttf",
					"./assets/fonts/NotoSansKR-Black.ttf",
				],
			},
		],
		"@sentry/react-native/expo",
		"./plugins/with-sentry-upload-guard",
		// 위치 권한은 expo-location이 맡는다. 이 플러그인의 ios/android 권한 옵션은 쓰지 않는다.
		["@mj-studio/react-native-naver-map", { client_id: naverMapClientId }],
	],
	scheme: "Betro",
	slug: "Betro",
	userInterfaceStyle: "automatic",
	version: "1.0.0",
	web: {
		bundler: "metro",
		favicon: "./assets/images/favicon.png",
		output: "static",
	},
};

export default config;

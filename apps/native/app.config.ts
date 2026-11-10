import type { ExpoConfig } from "expo/config";

// Expo CLI가 app config를 읽기 전에 apps/native/.env를 process.env에 불러온다.
const naverMapClientId = process.env.NAVER_MAP_CLIENT_ID;
if (!naverMapClientId) {
	throw new Error(
		"NAVER_MAP_CLIENT_ID가 없습니다. NCP 콘솔 Maps Application의 Client ID를 apps/native/.env에 넣어주세요."
	);
}

const NAVER_MAP_MAVEN_REPO = "https://repository.map.naver.com/archive/maven";

const config: ExpoConfig = {
	android: {
		adaptiveIcon: {
			backgroundColor: "#0e0f10",
			backgroundImage: "./assets/images/android-icon-background.png",
			foregroundImage: "./assets/images/android-icon-foreground.png",
			monochromeImage: "./assets/images/android-icon-monochrome.png",
		},
		googleServicesFile: "./google-services.json",
		package: "com.cmu02.betro",
		predictiveBackGestureEnabled: false,
	},
	experiments: {
		reactCompiler: true,
		typedRoutes: true,
	},
	icon: "./assets/images/icon.png",
	ios: {
		bundleIdentifier: "com.cmu02.betro",
		entitlements: {
			"aps-environment": "development",
		},
		googleServicesFile: "./GoogleService-Info.plist",
		infoPlist: {
			UIBackgroundModes: ["remote-notification"],
		},
		supportsTablet: true,
	},
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
		"@react-native-firebase/app",
		"@react-native-firebase/messaging",
		[
			"expo-location",
			{
				locationWhenInUsePermission:
					"내 주변 역과 정류장을 바로 보여주기 위해 위치를 사용해요.",
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
					"./assets/fonts/JetBrainsMono-Medium.ttf",
					"./assets/fonts/JetBrainsMono-Bold.ttf",
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

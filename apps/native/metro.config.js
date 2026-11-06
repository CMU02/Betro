const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const {
	withVarlockMetroConfig,
} = require("@varlock/expo-integration/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const {
	wrapWithReanimatedMetroConfig,
} = require("react-native-reanimated/metro-config");

/**
 * Sentry가 `expo/metro-config`의 기본 설정을 만들고, 소스맵용 debug ID를 번들에 넣는다.
 * @type {import('expo/metro-config').MetroConfig}
 */
// biome-ignore lint/correctness/noGlobalDirnameFilename: Expo는 이 파일을 CommonJS로 읽으므로 import.meta를 쓸 수 없다.
const config = getSentryExpoConfig(__dirname);

const uniwindConfig = withUniwindConfig(wrapWithReanimatedMetroConfig(config), {
	cssEntryFile: "./global.css",
	dtsFile: "./uniwind-types.d.ts",
});

module.exports = withVarlockMetroConfig(uniwindConfig);

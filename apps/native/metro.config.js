const {
	withVarlockMetroConfig,
} = require("@varlock/expo-integration/metro-config");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const {
	wrapWithReanimatedMetroConfig,
} = require("react-native-reanimated/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
// biome-ignore lint/correctness/noGlobalDirnameFilename: Expo는 이 파일을 CommonJS로 읽으므로 import.meta를 쓸 수 없다.
const config = getDefaultConfig(__dirname);

const uniwindConfig = withUniwindConfig(wrapWithReanimatedMetroConfig(config), {
	cssEntryFile: "./global.css",
	dtsFile: "./uniwind-types.d.ts",
});

module.exports = withVarlockMetroConfig(uniwindConfig);

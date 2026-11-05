module.exports = {
	plugins: [
		require("@varlock/expo-integration/babel-plugin"),
		require("./babel-plugins/hermes-async-arrow-rest-params"),
	],
	presets: ["babel-preset-expo"],
};

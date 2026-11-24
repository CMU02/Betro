import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExpoConfig } from "expo/config";

// CommonJS 플러그인이라 require로 읽는다. 검사 문구를 그대로 실행해 본다.
const sentryGuard = require("./plugins/with-sentry-upload-guard") as {
	GRADLE_GUARD: string;
	XCODE_ENV_GUARD: string;
};

// 셸에 남은 값이 결과를 정하지 않도록 매번 지우는 키
const CONTROLLED_KEYS = [
	"EAS_BUILD_PROFILE",
	"EXPO_PUBLIC_SENTRY_DSN",
	"GOOGLE_SERVICES_JSON",
	"GOOGLE_SERVICE_INFO_PLIST",
	"NAVER_MAP_CLIENT_ID",
];

const savedEnv = { ...process.env };
let loadCount = 0;

afterEach(() => {
	for (const key of Object.keys(process.env)) {
		if (!(key in savedEnv)) {
			delete process.env[key];
		}
	}
	Object.assign(process.env, savedEnv);
});

// process.env를 바꾼 뒤 app.config.ts를 새 모듈로 다시 읽는다.
async function load(env: Record<string, string>): Promise<ExpoConfig> {
	for (const key of CONTROLLED_KEYS) {
		delete process.env[key];
	}
	Object.assign(process.env, { NAVER_MAP_CLIENT_ID: "test-client" }, env);
	loadCount += 1;
	const specifier = `./app.config.ts?v=${loadCount}`;
	const mod = (await import(specifier)) as { default: ExpoConfig };
	return mod.default;
}

function pluginOptions(
	config: ExpoConfig,
	name: string
): Record<string, unknown> | undefined {
	for (const plugin of config.plugins ?? []) {
		if (Array.isArray(plugin) && plugin[0] === name) {
			return plugin[1] as Record<string, unknown>;
		}
	}
}

describe("app.config.ts 릴리스 설정", () => {
	it("production 프로필에 DSN이 없으면 설정을 읽을 때 멈춘다", async () => {
		await expect(load({ EAS_BUILD_PROFILE: "production" })).rejects.toThrow(
			"EXPO_PUBLIC_SENTRY_DSN"
		);
	});

	it("production 프로필에 DSN이 있으면 읽힌다", async () => {
		const config = await load({
			EAS_BUILD_PROFILE: "production",
			EXPO_PUBLIC_SENTRY_DSN: "https://dsn.invalid/1",
		});
		expect(config.name).toBe("Betro");
	});

	it("프로필이 없으면 DSN 없이도 읽힌다", async () => {
		const config = await load({});
		expect(config.name).toBe("Betro");
	});

	it("위치 Always 문구를 넣지 않고 사용 중 문구는 한국어다", async () => {
		const config = await load({});
		const location = pluginOptions(config, "expo-location");
		expect(location).toMatchObject({
			isAndroidBackgroundLocationEnabled: false,
			isIosBackgroundLocationEnabled: false,
			locationAlwaysAndWhenInUsePermission: false,
			locationAlwaysPermission: false,
			locationFullAccuracyPermission: false,
			motionUsagePermission: false,
		});
		expect(location?.locationWhenInUsePermission).toContain("위치");
	});

	it("암호화 면제, iPad 끔, 개인정보 수집 항목 세 개", async () => {
		const config = await load({});
		expect(config.ios?.config?.usesNonExemptEncryption).toBe(false);
		expect(config.ios?.supportsTablet).toBe(false);
		const collected = config.ios?.privacyManifests?.NSPrivacyCollectedDataTypes;
		expect(collected?.map((item) => item.NSPrivacyCollectedDataType)).toEqual([
			"NSPrivacyCollectedDataTypeCrashData",
			"NSPrivacyCollectedDataTypeOtherDiagnosticData",
			"NSPrivacyCollectedDataTypeDeviceID",
		]);
		for (const item of collected ?? []) {
			expect(item).toMatchObject({
				NSPrivacyCollectedDataTypeLinked: false,
				NSPrivacyCollectedDataTypePurposes: [
					"NSPrivacyCollectedDataTypePurposeAppFunctionality",
				],
				NSPrivacyCollectedDataTypeTracking: false,
			});
		}
	});

	it("쓰지 않는 Android 권한을 막는다", async () => {
		const config = await load({});
		expect(config.android?.blockedPermissions).toEqual([
			"android.permission.READ_EXTERNAL_STORAGE",
			"android.permission.WRITE_EXTERNAL_STORAGE",
			"android.permission.SYSTEM_ALERT_WINDOW",
		]);
	});

	it("Firebase 설정 파일 경로는 EAS 파일 환경 변수가 있으면 그것을 쓴다", async () => {
		const local = await load({});
		expect(local.android?.googleServicesFile).toBe("./google-services.json");
		expect(local.ios?.googleServicesFile).toBe("./GoogleService-Info.plist");

		const eas = await load({
			GOOGLE_SERVICE_INFO_PLIST: "/eas/secret/GoogleService-Info.plist",
			GOOGLE_SERVICES_JSON: "/eas/secret/google-services.json",
		});
		expect(eas.android?.googleServicesFile).toBe(
			"/eas/secret/google-services.json"
		);
		expect(eas.ios?.googleServicesFile).toBe(
			"/eas/secret/GoogleService-Info.plist"
		);
	});
});

describe("Sentry 업로드 검사", () => {
	// PROJECT_DIR의 상위에 .env가 없는 빈 폴더에서 돌려 실제 .env를 읽지 않는다.
	function runXcodeGuard(env: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), "betro-sentry-guard-"));
		const projectDir = join(root, "ios");
		mkdirSync(projectDir);
		try {
			const script = `${sentryGuard.XCODE_ENV_GUARD}\nprintf '%s' "\${SENTRY_DISABLE_AUTO_UPLOAD:-}"`;
			return spawnSync("sh", ["-c", script], {
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "", PROJECT_DIR: projectDir, ...env },
			});
		} finally {
			rmSync(root, { force: true, recursive: true });
		}
	}

	const ALL_SENTRY = {
		SENTRY_AUTH_TOKEN: "token",
		SENTRY_ORG: "org",
		SENTRY_PROJECT: "project",
	};

	it("production 프로필에 Sentry 값이 없으면 Xcode 단계가 실패한다", () => {
		const result = runXcodeGuard({ EAS_BUILD_PROFILE: "production" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("SENTRY_AUTH_TOKEN");
	});

	it("프로필이 없으면 업로드만 건너뛰고 계속한다", () => {
		const result = runXcodeGuard({});
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("true");
	});

	it("production 프로필에 Sentry 값이 모두 있으면 업로드한다", () => {
		const result = runXcodeGuard({
			EAS_BUILD_PROFILE: "production",
			...ALL_SENTRY,
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("Gradle도 production 프로필이면 Sentry 값이 없을 때 GradleException으로 멈춘다", () => {
		expect(sentryGuard.GRADLE_GUARD).toContain(
			'System.getenv("EAS_BUILD_PROFILE") == "production"'
		);
		expect(sentryGuard.GRADLE_GUARD).toContain("throw new GradleException");
	});
});

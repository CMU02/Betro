const fs = require("node:fs");
const path = require("node:path");
const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");

/**
 * Release 빌드에서 SENTRY_AUTH_TOKEN이 없으면 Sentry 소스맵·디버그 심볼 업로드를 건너뛴다(빌드는 계속).
 * 토큰은 셸 환경변수나 apps/native/.env 둘 중 하나에 있으면 된다. 값은 읽지 않고 "비어 있지 않은지"만 본다.
 * Debug 빌드는 Sentry 스크립트가 원래 업로드하지 않는다.
 */

const MARKER = "betro-sentry-upload-guard";

// ios/.xcode.env는 번들 단계와 Sentry 디버그 심볼 단계가 모두 읽는다.
const XCODE_ENV_GUARD = `
# ${MARKER}: SENTRY_AUTH_TOKEN·SENTRY_ORG·SENTRY_PROJECT 중 하나라도 없으면 Sentry 업로드를 건너뛴다(빌드는 계속).
BETRO_SENTRY_DOTENV="$PROJECT_DIR/../.env"
betro_sentry_has() {
  if [ -n "$(printenv "$1")" ]; then
    return 0
  fi
  grep -Eqs "^[[:space:]]*$1[[:space:]]*=[[:space:]]*[\\"']?[^[:space:]#\\"']" "$BETRO_SENTRY_DOTENV"
}
if betro_sentry_has SENTRY_AUTH_TOKEN && betro_sentry_has SENTRY_ORG && betro_sentry_has SENTRY_PROJECT; then
  if [ -z "$SENTRY_DOTENV_PATH" ] && [ -f "$BETRO_SENTRY_DOTENV" ]; then
    export SENTRY_DOTENV_PATH="$BETRO_SENTRY_DOTENV"
  fi
else
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi
`;

// sentry.gradle.kts를 적용한 뒤(파일 끝)에 업로드 조건을 덧씌운다.
const GRADLE_GUARD = `
// ${MARKER}: SENTRY_AUTH_TOKEN·SENTRY_ORG·SENTRY_PROJECT 중 하나라도 없으면 Sentry 소스맵 업로드를 건너뛴다(빌드는 계속).
def betroSentryHas = { String key ->
    if (System.getenv(key)?.trim()) {
        return true
    }
    def dotenv = new File(rootDir, "../.env")
    return dotenv.isFile() && dotenv.readLines().any { it ==~ /^\\s*\${key}\\s*=\\s*["']?[^\\s#"'].*/ }
}
if (project.ext.has("shouldSentryAutoUploadGeneral")) {
    def betroSentryAutoUploadDefault = project.ext.shouldSentryAutoUploadGeneral
    project.ext.shouldSentryAutoUploadGeneral = { ->
        betroSentryAutoUploadDefault() && ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"].every { betroSentryHas(it) }
    }
}
`;

function withIosGuard(config) {
	return withDangerousMod(config, [
		"ios",
		(modConfig) => {
			const file = path.join(
				modConfig.modRequest.platformProjectRoot,
				".xcode.env"
			);
			const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
			if (!current.includes(MARKER)) {
				fs.writeFileSync(file, `${current.trimEnd()}\n${XCODE_ENV_GUARD}`);
			}
			return modConfig;
		},
	]);
}

function withAndroidGuard(config) {
	return withAppBuildGradle(config, (modConfig) => {
		const { contents } = modConfig.modResults;
		if (!contents.includes(MARKER)) {
			modConfig.modResults.contents = `${contents.trimEnd()}\n${GRADLE_GUARD}`;
		}
		return modConfig;
	});
}

module.exports = (config) => withAndroidGuard(withIosGuard(config));

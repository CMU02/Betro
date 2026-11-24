const fs = require("node:fs");
const path = require("node:path");
const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");

/**
 * Release 빌드에서 SENTRY_AUTH_TOKEN이 없으면 Sentry 소스맵·디버그 심볼 업로드를 건너뛴다(빌드는 계속).
 * 단 EAS production 프로필(EAS_BUILD_PROFILE=production)은 건너뛰지 않고 빌드를 멈춘다.
 * 소스맵이 없으면 크래시 줄을 읽을 수 없기 때문이다. 비밀 값은 EAS 빌드 기계에서만 보여서 설정 읽기가 아니라 빌드 단계에서 본다.
 * 토큰은 셸 환경변수나 apps/native/.env 둘 중 하나에 있으면 된다. 값은 읽지 않고 "비어 있지 않은지"만 본다.
 * Debug 빌드는 Sentry 스크립트가 원래 업로드하지 않는다.
 */

const MARKER = "betro-sentry-upload-guard";

// ios/.xcode.env는 번들 단계와 Sentry 디버그 심볼 단계가 모두 읽는다.
const XCODE_ENV_GUARD = `
# ${MARKER}: SENTRY_AUTH_TOKEN·SENTRY_ORG·SENTRY_PROJECT 중 하나라도 없으면 Sentry 업로드를 건너뛴다(빌드는 계속).
# EAS production 프로필이면 건너뛰지 않고 빌드를 멈춘다.
BETRO_SENTRY_DOTENV="$PROJECT_DIR/../.env"
# Sentry 디버그 심볼 단계는 set -x로 이 파일을 읽는다. 값을 펼치면 토큰이 빌드 로그에 찍히므로 "x"로만 바꿔 본다.
betro_sentry_has() {
  if eval "[ -n \\"\\\${$1:+x}\\" ]"; then
    return 0
  fi
  grep -Eqs "^[[:space:]]*$1[[:space:]]*=[[:space:]]*[\\"']?[^[:space:]#\\"']" "$BETRO_SENTRY_DOTENV"
}
if betro_sentry_has SENTRY_AUTH_TOKEN && betro_sentry_has SENTRY_ORG && betro_sentry_has SENTRY_PROJECT; then
  if [ -z "$SENTRY_DOTENV_PATH" ] && [ -f "$BETRO_SENTRY_DOTENV" ]; then
    export SENTRY_DOTENV_PATH="$BETRO_SENTRY_DOTENV"
  fi
elif [ "$EAS_BUILD_PROFILE" = "production" ]; then
  echo "error: production 빌드에는 SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT가 모두 있어야 합니다." >&2
  exit 1
else
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi
`;

// sentry.gradle.kts를 적용한 뒤(파일 끝)에 업로드 조건을 덧씌운다.
const GRADLE_GUARD = `
// ${MARKER}: SENTRY_AUTH_TOKEN·SENTRY_ORG·SENTRY_PROJECT 중 하나라도 없으면 Sentry 소스맵 업로드를 건너뛴다(빌드는 계속).
// EAS production 프로필이면 건너뛰지 않고 빌드를 멈춘다.
def betroSentryHas = { String key ->
    if (System.getenv(key)?.trim()) {
        return true
    }
    def dotenv = new File(rootDir, "../.env")
    return dotenv.isFile() && dotenv.readLines().any { it ==~ /^\\s*\${key}\\s*=\\s*["']?[^\\s#"'].*/ }
}
def betroSentryKeys = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]
if (System.getenv("EAS_BUILD_PROFILE") == "production" && !betroSentryKeys.every { betroSentryHas(it) }) {
    throw new GradleException("production 빌드에는 SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT가 모두 있어야 합니다.")
}
if (project.ext.has("shouldSentryAutoUploadGeneral")) {
    def betroSentryAutoUploadDefault = project.ext.shouldSentryAutoUploadGeneral
    project.ext.shouldSentryAutoUploadGeneral = { ->
        betroSentryAutoUploadDefault() && betroSentryKeys.every { betroSentryHas(it) }
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
			const next = applyXcodeEnvGuard(current);
			if (next !== current) {
				fs.writeFileSync(file, next);
			}
			return modConfig;
		},
	]);
}

// 검사 문구는 늘 파일 끝에 붙인다. 옛 문구가 있으면 표시 줄부터 끝까지 지우고 지금 문구로 바꾼다.
// --clean 없이 prebuild해도 예전 검사가 남지 않게 하려는 것이다.
function applyXcodeEnvGuard(current) {
	const start = current.indexOf(`# ${MARKER}`);
	const head = start === -1 ? current : current.slice(0, start);
	return `${head.trimEnd()}\n${XCODE_ENV_GUARD}`;
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
// 테스트가 검사 문구를 그대로 실행해 본다.
module.exports.XCODE_ENV_GUARD = XCODE_ENV_GUARD;
module.exports.applyXcodeEnvGuard = applyXcodeEnvGuard;
module.exports.GRADLE_GUARD = GRADLE_GUARD;

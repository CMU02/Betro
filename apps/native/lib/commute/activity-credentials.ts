import type { InstallIdentity } from "@/lib/device/install-identity";

export interface ActivityCredentials {
	installId: string;
	secret: string;
	serverUrl: string;
}

export interface PassActivityCredentialsDeps {
	identity: InstallIdentity;
	platform: string;
	serverUrl: string;
	setCredentials: (input: ActivityCredentials) => Promise<void>;
}

const TRAILING_SLASHES = /\/+$/;

/**
 * iOS 네이티브 토큰 보고기와 잠금화면 버튼이 JS 없이 서버에 인증할 수 있게 설치 ID, 비밀값,
 * 서버 주소를 모듈 전용 키체인 항목에 넘긴다. Android는 헤드리스 JS가 보안 저장소에서 직접 읽으므로
 * 넘기지 않는다. 네이티브 실패는 그대로 올려 호출하는 쪽이 기록한다.
 */
export async function passActivityCredentials(
	deps: PassActivityCredentialsDeps
): Promise<"passed" | "skipped"> {
	const serverUrl = deps.serverUrl.trim().replace(TRAILING_SLASHES, "");
	if (deps.platform !== "ios" || serverUrl === "") {
		return "skipped";
	}
	await deps.setCredentials({
		installId: deps.identity.installId,
		secret: deps.identity.secret,
		serverUrl,
	});
	return "passed";
}

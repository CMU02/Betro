import type { ServerClient } from "../server/api-client";

const HTTP_NO_CONTENT = 204;

export interface CommuteActionInput {
	kind: "end";
	sessionId: string;
}

/**
 * 알림의 "종료"를 서버에 보낸다(헤드리스 태스크 `CommuteAction`). 204일 때만 알림을 지우고,
 * 실패하면 알림을 그대로 둔다(서버가 끝내지 않았는데 화면만 바꾸지 않는다).
 */
export async function handleCommuteAction(
	input: CommuteActionInput,
	deps: { client: ServerClient; notifier: { end: (sessionId: string) => void } }
): Promise<boolean> {
	const response = await deps.client.request(
		"POST",
		`/v1/commute/sessions/${encodeURIComponent(input.sessionId)}/input`,
		{ kind: input.kind }
	);
	if (response.status !== HTTP_NO_CONTENT) {
		return false;
	}
	deps.notifier.end(input.sessionId);
	return true;
}

/** Android 설치의 FCM 토큰을 서버에 등록한다. 앱 시작과 토큰 갱신 때 부른다. */
export async function registerFcmToken(
	client: ServerClient,
	token: string
): Promise<boolean> {
	const response = await client.request("PUT", "/v1/push-tokens", {
		env: "production",
		kind: "fcm",
		token,
	});
	return response.status >= 200 && response.status < 300;
}

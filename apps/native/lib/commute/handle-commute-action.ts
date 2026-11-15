import type { ServerClient } from "../server/api-client";
import { endSession } from "./session-client";

export interface CommuteActionInput {
	kind: "end";
	sessionId: string;
}

/**
 * 알림의 "종료"를 서버에 보낸다(헤드리스 태스크 `CommuteAction`). 서버가 끝냈거나(204) 이미 없는
 * 세션이면(404·409) 알림을 지우고, 실패하면 그대로 둔다(서버가 끝내지 않았는데 화면만 바꾸지 않는다).
 */
export async function handleCommuteAction(
	input: CommuteActionInput,
	deps: { client: ServerClient; notifier: { end: (sessionId: string) => void } }
): Promise<boolean> {
	if ((await endSession(deps.client, input.sessionId)) === "failed") {
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

/**
 * 토큰 보내기를 감싼다. 서버가 받은 토큰은 다시 보내지 않고, 실패하면 다음 부름(앱이 앞으로 오거나
 * 연결이 돌아올 때)에 다시 보낸다. 같은 토큰을 보내는 중이면 겹쳐 보내지 않는다.
 */
export function createFcmTokenSender(
	send: (token: string) => Promise<boolean>
): (token: string) => Promise<void> {
	let accepted: string | null = null;
	let sending: string | null = null;
	return async (token) => {
		if (token === accepted || token === sending) {
			return;
		}
		sending = token;
		try {
			if (await send(token)) {
				accepted = token;
			}
		} finally {
			if (sending === token) {
				sending = null;
			}
		}
	};
}

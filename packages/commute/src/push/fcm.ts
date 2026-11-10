import type { ContentState } from "../session/content";
import type { PushOutcome } from "./apns";

export const FCM_TTL_SECONDS = 120;

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;

/** 데이터 메시지만 보낸다(notification 블록 없음). 문장은 기기가 만든다. */
export function fcmCommuteRequest(input: {
	accessToken: string;
	event: "start" | "update" | "end";
	planId: string;
	projectId: string;
	sessionId: string;
	state: ContentState;
	token: string;
}): Request {
	return new Request(
		`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(input.projectId)}/messages:send`,
		{
			body: JSON.stringify({
				message: {
					android: {
						collapse_key: input.sessionId,
						priority: "HIGH",
						ttl: `${FCM_TTL_SECONDS}s`,
					},
					data: {
						event: input.event,
						planId: input.planId,
						sessionId: input.sessionId,
						state: JSON.stringify(input.state),
						type: "commute",
					},
					token: input.token,
				},
			}),
			headers: {
				Authorization: `Bearer ${input.accessToken}`,
				"Content-Type": "application/json; charset=utf-8",
			},
			method: "POST",
		}
	);
}

export function classifyFcm(
	status: number,
	errorStatus: string | null
): PushOutcome {
	if (status === HTTP_OK) {
		return "ok";
	}
	if (
		(status === HTTP_NOT_FOUND && errorStatus === "UNREGISTERED") ||
		(status === HTTP_BAD_REQUEST && errorStatus === "INVALID_ARGUMENT")
	) {
		return "token-dead";
	}
	if (status === HTTP_UNAUTHORIZED) {
		return "jwt-expired";
	}
	if (status === HTTP_TOO_MANY || status >= HTTP_SERVER_ERROR) {
		return "retry";
	}
	if (status === HTTP_FORBIDDEN) {
		return "config";
	}
	return "config";
}

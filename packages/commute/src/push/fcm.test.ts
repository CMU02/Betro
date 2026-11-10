import { describe, expect, it } from "bun:test";
import type { ContentState } from "../session/content";
import { classifyFcm, FCM_TTL_SECONDS, fcmCommuteRequest } from "./fcm";

const STATE = {
	delayMinutes: 0,
	destinationEtaEpoch: 1_800_002_000,
	etaEpoch: 1_800_000_300,
	etaState: "live",
	leaveEpoch: null,
	legCount: 1,
	legIndex: 0,
	lineName: "6411",
	mode: "bus",
	passed: null,
	positionState: "live",
	sentAt: 1_800_000_000,
	seq: 1,
	stage: "walk",
	stopName: "강남역",
	stopsAway: 3,
	suggestion: null,
	v: 1,
} satisfies ContentState;

const input = {
	accessToken: "oauth-token",
	event: "update" as const,
	planId: "plan-1",
	projectId: "betro-proj",
	sessionId: "sess-1",
	state: STATE,
	token: "fcm-device-token",
};

describe("fcmCommuteRequest", () => {
	it("URL 과 인증 헤더", () => {
		const request = fcmCommuteRequest(input);
		expect(request.method).toBe("POST");
		expect(request.url).toBe(
			"https://fcm.googleapis.com/v1/projects/betro-proj/messages:send"
		);
		expect(request.headers.get("authorization")).toBe("Bearer oauth-token");
	});

	it("높은 우선순위 데이터 메시지이고 ttl 120s, collapse_key 는 세션 ID", async () => {
		expect(FCM_TTL_SECONDS).toBe(120);
		const { message } = (await fcmCommuteRequest(input).json()) as {
			message: Record<string, unknown>;
		};
		expect(message.token).toBe("fcm-device-token");
		expect(message.android).toEqual({
			collapse_key: "sess-1",
			priority: "HIGH",
			ttl: "120s",
		});
	});

	it("data 의 모든 값이 문자열이고 notification 이 없다", async () => {
		const { message } = (await fcmCommuteRequest(input).json()) as {
			message: { data: Record<string, unknown> } & Record<string, unknown>;
		};
		expect(message.notification).toBeUndefined();
		expect(message.data).toEqual({
			event: "update",
			planId: "plan-1",
			sessionId: "sess-1",
			state: JSON.stringify(STATE),
			type: "commute",
		});
		for (const value of Object.values(message.data)) {
			expect(typeof value).toBe("string");
		}
	});
});

describe("classifyFcm", () => {
	it("200 은 ok", () => {
		expect(classifyFcm(200, null)).toBe("ok");
	});
	it("죽은 토큰", () => {
		expect(classifyFcm(404, "UNREGISTERED")).toBe("token-dead");
		expect(classifyFcm(400, "INVALID_ARGUMENT")).toBe("token-dead");
	});
	it("401 은 jwt-expired, 403 은 config", () => {
		expect(classifyFcm(401, null)).toBe("jwt-expired");
		expect(classifyFcm(403, "PERMISSION_DENIED")).toBe("config");
	});
	it("재시도", () => {
		expect(classifyFcm(429, "QUOTA_EXCEEDED")).toBe("retry");
		expect(classifyFcm(503, "UNAVAILABLE")).toBe("retry");
	});
});

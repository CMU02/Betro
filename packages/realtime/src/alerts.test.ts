import { describe, expect, it } from "bun:test";
import {
	type AlertState,
	decideAlerts,
	emptyAlertState,
	FCM_PROJECT_ID,
	FCM_SCOPE,
	fcmAccessTokenRequest,
	fcmSendRequest,
	GOOGLE_TOKEN_URL,
} from "./alerts";
import type { CollectorHealth, CollectorStatus } from "./metrics";

const MINUTE = 60_000;
const T0 = 1_793_678_400_000;

function statusOf(
	health: CollectorHealth,
	lastSuccessAt: number | null,
	now: number
): CollectorStatus {
	return {
		generatedAt: now,
		lines: [],
		mode: "dev",
		overall: health,
		series: [],
		sources: [
			{
				errorsToday: {},
				freshnessMs: null,
				health,
				lastSuccessAt,
				name: "subway",
				remainingToday: 900,
				usedToday: 0,
			},
		],
	};
}

describe("alert decisions", () => {
	it("alerts are deduplicated and recover once", () => {
		const lastOk = T0 - 16 * MINUTE;
		let state: AlertState = emptyAlertState();
		const step = (
			health: CollectorHealth,
			lastSuccessAt: number | null,
			at: number
		): string[] => {
			const { next, send } = decideAlerts(
				state,
				statusOf(health, lastSuccessAt, at),
				{},
				at
			);
			state = JSON.parse(JSON.stringify(next));
			return send.map((a) => `${a.title}|${a.body}`);
		};
		expect(step("stalled", lastOk, T0)).toEqual([
			"Betro 수집 멈춤|지하철 수집이 15분 넘게 멈췄습니다.",
		]);
		expect(step("stalled", lastOk, T0 + 10 * MINUTE)).toEqual([]);
		expect(step("stalled", lastOk, T0 + 31 * MINUTE)).toHaveLength(1);
		const back = T0 + 40 * MINUTE;
		expect(step("ok", back, back)).toEqual([
			"Betro 수집 회복|지하철 수집이 다시 정상입니다.",
		]);
		expect(step("ok", back + MINUTE, back + MINUTE)).toEqual([]);
		expect(step("ok", back + 5 * MINUTE, back + 5 * MINUTE)).toEqual([]);
	});

	it("waits for a real success before recovering", () => {
		const first = decideAlerts(
			emptyAlertState(),
			statusOf("stalled", null, T0),
			{},
			T0
		);
		// 운행 시간 밖, 또는 성공 없이 "정상"으로 보이는 운행 시작 직후는 회복이 아니다.
		const offHours = decideAlerts(
			first.next,
			statusOf("off-hours", null, T0 + 5 * MINUTE),
			{},
			T0 + 5 * MINUTE
		);
		expect(offHours.send).toEqual([]);
		const noSuccess = decideAlerts(
			offHours.next,
			statusOf("ok", T0 - MINUTE, T0 + 6 * MINUTE),
			{},
			T0 + 6 * MINUTE
		);
		expect(noSuccess.send).toEqual([]);
		const recovered = decideAlerts(
			noSuccess.next,
			statusOf("ok", T0 + 7 * MINUTE, T0 + 7 * MINUTE),
			{},
			T0 + 7 * MINUTE
		);
		expect(recovered.send.map((a) => a.kind)).toEqual(["recovered"]);
	});

	it("sends one auth alert per failure", () => {
		const status = statusOf("ok", T0, T0);
		const first = decideAlerts(emptyAlertState(), status, { subway: T0 }, T0);
		expect(first.send).toEqual([
			{
				body: "지하철 API가 401을 돌려줬습니다.",
				kind: "auth",
				title: "Betro 키 오류",
			},
		]);
		const again = decideAlerts(
			first.next,
			status,
			{ subway: T0 },
			T0 + 40 * MINUTE
		);
		expect(again.send).toEqual([]);
		const nextDay = T0 + 24 * 60 * MINUTE;
		const later = decideAlerts(
			again.next,
			status,
			{ subway: nextDay },
			nextDay
		);
		expect(later.send.map((a) => a.kind)).toEqual(["auth"]);
	});
});

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
	const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
	const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function serviceAccount(): Promise<{
	json: string;
	publicKey: CryptoKey;
}> {
	const pair = await crypto.subtle.generateKey(
		{
			hash: "SHA-256",
			modulusLength: 2048,
			name: "RSASSA-PKCS1-v1_5",
			publicExponent: new Uint8Array([1, 0, 1]),
		},
		true,
		["sign", "verify"]
	);
	const der = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey)
	);
	const b64 = btoa(String.fromCharCode(...der));
	const lines = b64.match(/.{1,64}/g) ?? [];
	const pem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
	const json = JSON.stringify({
		client_email: "collector@betro-a77a2.iam.gserviceaccount.com",
		private_key: pem,
		project_id: FCM_PROJECT_ID,
		type: "service_account",
	});
	return { json, publicKey: pair.publicKey };
}

describe("fcm", () => {
	it("signs a verifiable fcm jwt", async () => {
		const { json, publicKey } = await serviceAccount();
		const now = 1_793_678_684_123;
		const request = await fcmAccessTokenRequest(json, now);
		expect(request.method).toBe("POST");
		expect(request.url).toBe(GOOGLE_TOKEN_URL);
		expect(request.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded"
		);
		const form = new URLSearchParams(await request.text());
		expect(form.get("grant_type")).toBe(
			"urn:ietf:params:oauth:grant-type:jwt-bearer"
		);
		const [header, claims, signature] = (form.get("assertion") ?? "").split(
			"."
		) as [string, string, string];
		const valid = await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			publicKey,
			base64UrlDecode(signature),
			new TextEncoder().encode(`${header}.${claims}`)
		);
		expect(valid).toBe(true);
		const decode = (part: string): unknown =>
			JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
		expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
		const iat = Math.floor(now / 1000);
		expect(decode(claims)).toEqual({
			aud: "https://oauth2.googleapis.com/token",
			exp: iat + 3600,
			iat,
			iss: "collector@betro-a77a2.iam.gserviceaccount.com",
			scope: FCM_SCOPE,
		});
	});

	it("rejects a service account without a pkcs8 key", async () => {
		const json = JSON.stringify({
			client_email: "a@b",
			private_key:
				"-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----",
		});
		await expect(fcmAccessTokenRequest(json, 0)).rejects.toThrow("PKCS#8");
		await expect(fcmAccessTokenRequest("{", 0)).rejects.toThrow(
			"not valid JSON"
		);
	});

	it("builds an fcm v1 send request", async () => {
		const request = fcmSendRequest(
			FCM_PROJECT_ID,
			"access-token",
			"device-token",
			"Betro 수집 멈춤",
			"지하철 수집이 15분 넘게 멈췄습니다."
		);
		expect(request.method).toBe("POST");
		expect(request.url).toBe(
			"https://fcm.googleapis.com/v1/projects/betro-a77a2/messages:send"
		);
		expect(request.headers.get("authorization")).toBe("Bearer access-token");
		expect(await request.json()).toEqual({
			message: {
				android: { priority: "high" },
				notification: {
					body: "지하철 수집이 15분 넘게 멈췄습니다.",
					title: "Betro 수집 멈춤",
				},
				token: "device-token",
			},
		});
	});
});

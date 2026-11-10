import { describe, expect, it } from "bun:test";
import type { ContentState } from "../session/content";
import {
	APNS_JWT_MAX_AGE_MS,
	apnsEndRequest,
	apnsJwt,
	apnsStartRequest,
	apnsUpdateRequest,
	classifyApns,
	reusableJwt,
} from "./apns";

const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const DEVICE_TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TOPIC = "app.betro.example";
const BASE64_STANDARD_PAD = /[=]+$/;

const STATE: ContentState = {
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

function toBase64(bytes: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
	const padded = text.replaceAll("-", "+").replaceAll("_", "/");
	const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function makeKeyPair() {
	const pair = await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"]
	);
	const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
	const pem = `-----BEGIN PRIVATE KEY-----\n${toBase64(pkcs8)}\n-----END PRIVATE KEY-----\n`;
	return { pem, publicKey: pair.publicKey };
}

const startInput = {
	attributes: { planId: "plan-1", sessionId: "sess-1" },
	env: "sandbox" as const,
	jwt: "jwt-value",
	now: NOW,
	state: STATE,
	token: DEVICE_TOKEN,
	topic: TOPIC,
};

describe("apnsJwt", () => {
	it("ES256 헤더와 본문을 만들고 공개키로 검증된다", async () => {
		const { pem, publicKey } = await makeKeyPair();
		const jwt = await apnsJwt(pem, "KEYID12345", "TEAMID6789", 1_800_000_000);
		const [header, body, signature] = jwt.split(".") as [
			string,
			string,
			string,
		];
		expect(JSON.parse(new TextDecoder().decode(fromBase64Url(header)))).toEqual(
			{ alg: "ES256", kid: "KEYID12345" }
		);
		expect(JSON.parse(new TextDecoder().decode(fromBase64Url(body)))).toEqual({
			iat: 1_800_000_000,
			iss: "TEAMID6789",
		});
		const valid = await crypto.subtle.verify(
			{ hash: "SHA-256", name: "ECDSA" },
			publicKey,
			fromBase64Url(signature),
			new TextEncoder().encode(`${header}.${body}`)
		);
		expect(valid).toBe(true);
	});

	it("PKCS#8 PEM 이 아니면 키 내용 없이 던진다", async () => {
		await expect(apnsJwt("not a pem", "K", "T", 0)).rejects.toThrow("PKCS#8");
	});
});

describe("reusableJwt", () => {
	const cache = { issuedAt: NOW, token: "cached" };
	it("49분 된 것은 그대로 쓴다", () => {
		expect(reusableJwt(cache, NOW + 49 * MINUTE_MS)).toBe("cached");
	});
	it("50분 된 것과 없는 것은 null", () => {
		expect(APNS_JWT_MAX_AGE_MS).toBe(3_000_000);
		expect(reusableJwt(cache, NOW + 50 * MINUTE_MS)).toBeNull();
		expect(reusableJwt(undefined, NOW)).toBeNull();
	});
});

describe("apns 요청", () => {
	it("시작 요청의 URL, 헤더, 본문", async () => {
		const request = apnsStartRequest(startInput);
		expect(request.method).toBe("POST");
		expect(request.url).toBe(
			`https://api.sandbox.push.apple.com/3/device/${DEVICE_TOKEN}`
		);
		expect(request.headers.get("apns-push-type")).toBe("liveactivity");
		expect(request.headers.get("apns-topic")).toBe(
			`${TOPIC}.push-type.liveactivity`
		);
		expect(request.headers.get("apns-priority")).toBe("10");
		expect(request.headers.get("authorization")).toBe("bearer jwt-value");
		const body = await request.json();
		expect(body).toEqual({
			aps: {
				alert: {
					body: { "loc-key": "commute.start.body" },
					title: { "loc-key": "commute.start.title" },
				},
				attributes: { planId: "plan-1", sessionId: "sess-1" },
				"attributes-type": "CommuteActivityAttributes",
				"content-state": STATE,
				event: "start",
				timestamp: 1_800_000_000,
			},
		});
	});

	it("env 가 production 이면 운영 호스트", () => {
		const request = apnsStartRequest({ ...startInput, env: "production" });
		expect(new URL(request.url).host).toBe("api.push.apple.com");
	});

	it("갱신 요청은 우선순위와 stale-date 를 담는다", async () => {
		const request = apnsUpdateRequest({
			env: "sandbox",
			jwt: "j",
			now: NOW,
			priority: 5,
			staleAt: NOW + 150_000,
			state: STATE,
			token: DEVICE_TOKEN,
			topic: TOPIC,
		});
		expect(request.headers.get("apns-priority")).toBe("5");
		expect(request.headers.get("apns-push-type")).toBe("liveactivity");
		const { aps } = (await request.json()) as {
			aps: Record<string, unknown>;
		};
		expect(aps.event).toBe("update");
		expect(aps["stale-date"]).toBe(1_800_000_150);
		expect(aps.timestamp).toBe(1_800_000_000);
		expect(aps["content-state"]).toEqual(STATE);
	});

	it("종료 요청의 dismissal-date 는 now", async () => {
		const request = apnsEndRequest({
			env: "sandbox",
			jwt: "j",
			now: NOW,
			state: STATE,
			token: DEVICE_TOKEN,
			topic: TOPIC,
		});
		const { aps } = (await request.json()) as {
			aps: Record<string, unknown>;
		};
		expect(aps.event).toBe("end");
		expect(aps["dismissal-date"]).toBe(1_800_000_000);
		expect(aps.timestamp).toBe(1_800_000_000);
		expect(String(aps["dismissal-date"])).toHaveLength(10);
	});

	it("요청 어디에도 p8 원문이 없다", async () => {
		const { pem } = await makeKeyPair();
		const jwt = await apnsJwt(pem, "KEYID12345", "TEAMID6789", 1);
		const request = apnsStartRequest({ ...startInput, jwt });
		const headers = [...request.headers].flat().join("\n");
		const text = `${request.url}\n${headers}\n${await request.text()}`;
		const secret = pem
			.replace("-----BEGIN PRIVATE KEY-----", "")
			.replace("-----END PRIVATE KEY-----", "")
			.replaceAll("\n", "")
			.replace(BASE64_STANDARD_PAD, "");
		expect(text).not.toContain(secret.slice(0, 40));
		expect(text).not.toContain("BEGIN PRIVATE KEY");
	});
});

describe("classifyApns", () => {
	it("200 은 ok", () => {
		expect(classifyApns(200, null)).toBe("ok");
	});
	it("죽은 토큰", () => {
		expect(classifyApns(400, "BadDeviceToken")).toBe("token-dead");
		expect(classifyApns(410, "Unregistered")).toBe("token-dead");
		expect(classifyApns(410, "ExpiredToken")).toBe("token-dead");
	});
	it("JWT 문제", () => {
		expect(classifyApns(403, "ExpiredProviderToken")).toBe("jwt-expired");
		expect(classifyApns(403, "InvalidProviderToken")).toBe("jwt-expired");
	});
	it("설정 문제", () => {
		expect(classifyApns(400, "TopicDisallowed")).toBe("config");
		expect(classifyApns(400, "PayloadEmpty")).toBe("config");
		expect(classifyApns(403, "Forbidden")).toBe("config");
		expect(classifyApns(400, null)).toBe("config");
	});
	it("재시도", () => {
		expect(classifyApns(429, "TooManyRequests")).toBe("retry");
		expect(classifyApns(500, null)).toBe("retry");
		expect(classifyApns(503, "ServiceUnavailable")).toBe("retry");
	});
	it("sandbox 토큰을 운영 호스트로 보낸 400 도 token-dead", () => {
		expect(classifyApns(400, "BadDeviceToken")).toBe("token-dead");
	});
});

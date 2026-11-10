import type { ContentState } from "../session/content";

export const APNS_JWT_MAX_AGE_MS = 3_000_000;

const HOST_SANDBOX = "api.sandbox.push.apple.com";
const HOST_PRODUCTION = "api.push.apple.com";
const BASE64_PADDING = /[=]+$/;
const WHITESPACE = /\s+/g;
const PEM_PKCS8 =
	/-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/;
const ATTRIBUTES_TYPE = "CommuteActivityAttributes";
const PRIORITY_START = 10;
const MS_PER_SECOND = 1000;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_GONE = 410;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;

export type PushOutcome =
	| "ok"
	| "token-dead"
	| "jwt-expired"
	| "config"
	| "retry";

export interface ApnsJwtCache {
	issuedAt: number;
	token: string;
}

interface ApnsBase {
	env: "sandbox" | "production";
	jwt: string;
	/** 밀리초. APNs 필드로 나갈 때 초로 바꾼다. */
	now: number;
	state: ContentState;
	token: string;
	topic: string;
}

/** 패키지 전체가 밀리초를 쓰므로 APNs 로 나가는 값만 여기서 epoch 초로 바꾼다. */
function toEpochSec(ms: number): number {
	return Math.floor(ms / MS_PER_SECOND);
}

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(BASE64_PADDING, "");
}

function base64UrlJson(value: unknown): string {
	return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** PKCS#8 PEM -> DER. 키 내용은 오류 메시지에 넣지 않는다. */
function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
	const match = PEM_PKCS8.exec(pem);
	if (!match) {
		throw new Error("APNs key must be a PKCS#8 PEM");
	}
	const binary = atob((match[1] as string).replace(WHITESPACE, ""));
	const der = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		der[i] = binary.charCodeAt(i);
	}
	return der;
}

/** ES256 공급자 토큰. WebCrypto 의 ECDSA 서명은 JWT 가 요구하는 r||s 형식이다. */
export async function apnsJwt(
	p8Pem: string,
	keyId: string,
	teamId: string,
	issuedAtSec: number
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemToPkcs8(p8Pem),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"]
	);
	const signingInput = `${base64UrlJson({ alg: "ES256", kid: keyId })}.${base64UrlJson({ iat: issuedAtSec, iss: teamId })}`;
	const signature = await crypto.subtle.sign(
		{ hash: "SHA-256", name: "ECDSA" },
		key,
		new TextEncoder().encode(signingInput)
	);
	return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export function reusableJwt(
	cache: ApnsJwtCache | undefined,
	now: number
): string | null {
	if (!cache || now - cache.issuedAt >= APNS_JWT_MAX_AGE_MS) {
		return null;
	}
	return cache.token;
}

function build(
	input: ApnsBase,
	priority: 5 | 10,
	aps: Record<string, unknown>
): Request {
	const host = input.env === "sandbox" ? HOST_SANDBOX : HOST_PRODUCTION;
	return new Request(
		`https://${host}/3/device/${encodeURIComponent(input.token)}`,
		{
			body: JSON.stringify({ aps }),
			headers: {
				"apns-priority": String(priority),
				"apns-push-type": "liveactivity",
				"apns-topic": `${input.topic}.push-type.liveactivity`,
				authorization: `bearer ${input.jwt}`,
				"content-type": "application/json",
			},
			method: "POST",
		}
	);
}

export function apnsStartRequest(
	input: ApnsBase & {
		attributes: { planId: string; sessionId: string };
	}
): Request {
	return build(input, PRIORITY_START, {
		alert: {
			body: { "loc-key": "commute.start.body" },
			title: { "loc-key": "commute.start.title" },
		},
		attributes: input.attributes,
		"attributes-type": ATTRIBUTES_TYPE,
		"content-state": input.state,
		event: "start",
		timestamp: toEpochSec(input.now),
	});
}

export function apnsUpdateRequest(
	input: ApnsBase & { priority: 5 | 10; staleAt: number /* 밀리초 */ }
): Request {
	return build(input, input.priority, {
		"content-state": input.state,
		event: "update",
		"stale-date": toEpochSec(input.staleAt),
		timestamp: toEpochSec(input.now),
	});
}

export function apnsEndRequest(input: ApnsBase): Request {
	return build(input, PRIORITY_START, {
		"content-state": input.state,
		"dismissal-date": toEpochSec(input.now),
		event: "end",
		timestamp: toEpochSec(input.now),
	});
}

export function classifyApns(
	status: number,
	reason: string | null
): PushOutcome {
	if (status === HTTP_OK) {
		return "ok";
	}
	if (
		(status === HTTP_BAD_REQUEST && reason === "BadDeviceToken") ||
		(status === HTTP_GONE &&
			(reason === "Unregistered" || reason === "ExpiredToken"))
	) {
		return "token-dead";
	}
	if (
		status === HTTP_FORBIDDEN &&
		(reason === "ExpiredProviderToken" || reason === "InvalidProviderToken")
	) {
		return "jwt-expired";
	}
	if (status === HTTP_TOO_MANY || status >= HTTP_SERVER_ERROR) {
		return "retry";
	}
	return "config";
}

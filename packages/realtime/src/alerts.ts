import type { CollectorStatus } from "./metrics";

/** 같은 종류·같은 소스 알림은 이 간격에 한 번만 보낸다. */
export const ALERT_REPEAT_MS = 1_800_000;
/** Betro Firebase 프로젝트. */
export const FCM_PROJECT_ID = "betro-a77a2";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** FCM 액세스 토큰 JWT 유효 시간(초). Google 상한이 1시간이다. */
const JWT_LIFETIME_S = 3600;
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const BASE64_PADDING = /[=]+$/;
const WHITESPACE = /\s+/g;

export type AlertKind = "stalled" | "auth" | "recovered";

export interface Alert {
	body: string;
	kind: AlertKind;
	title: string;
}

/**
 * 알림 판단 상태. JSON으로 그대로 저장한다.
 * - `lastSentAt`: `${kind}:${source}` → 마지막으로 보낸 시각.
 * - `stalls`: 지금 멈춤으로 보고 있는 소스. `since`는 처음 멈춤을 본 시각,
 *   `announced`는 이번 멈춤에 대해 알림을 실제로 보냈는지(보냈을 때만 회복 알림을 보낸다).
 */
export interface AlertState {
	lastSentAt: Record<string, number>;
	stalls: Record<string, { since: number; announced: boolean }>;
}

export function emptyAlertState(): AlertState {
	return { lastSentAt: {}, stalls: {} };
}

const SOURCE_LABEL: Readonly<Record<string, string>> = {
	bus: "버스",
	subway: "지하철",
};

function label(source: string): string {
	return SOURCE_LABEL[source] ?? source;
}

function message(kind: AlertKind, source: string): Alert {
	const name = label(source);
	switch (kind) {
		case "stalled":
			return {
				body: `${name} 수집이 15분 넘게 멈췄습니다.`,
				kind,
				title: "Betro 수집 멈춤",
			};
		case "auth":
			return {
				body: `${name} API가 401을 돌려줬습니다.`,
				kind,
				title: "Betro 키 오류",
			};
		default:
			return {
				body: `${name} 수집이 다시 정상입니다.`,
				kind,
				title: "Betro 수집 회복",
			};
	}
}

/**
 * 보낼 알림과 다음 상태. 같은 종류(소스별)는 30분에 1번.
 * - auth: `authFailedAt[source]`(그 소스의 마지막 401 시각)가 마지막 auth 알림 뒤의 일이면 보낸다.
 * - stalled: 상태가 "멈춤"인 동안 30분마다.
 * - recovered: 알림을 보낸 멈춤이 끝나고(멈춤을 본 뒤 성공이 있고) 상태가 "정상"이 되면 1번.
 *   운행 시간 밖이나 "지연"은 아직 회복으로 보지 않는다.
 */
export function decideAlerts(
	prev: AlertState,
	status: CollectorStatus,
	authFailedAt: Readonly<Partial<Record<string, number | null>>>,
	now: number
): { send: Alert[]; next: AlertState } {
	const lastSentAt = { ...prev.lastSentAt };
	const stalls = { ...prev.stalls };
	const send: Alert[] = [];
	const canSend = (kind: AlertKind, source: string): boolean => {
		const last = lastSentAt[`${kind}:${source}`];
		return last === undefined || now - last >= ALERT_REPEAT_MS;
	};
	const emit = (kind: AlertKind, source: string): void => {
		send.push(message(kind, source));
		lastSentAt[`${kind}:${source}`] = now;
	};

	for (const source of status.sources) {
		const { name } = source;
		const failedAt = authFailedAt[name];
		const lastAuth = lastSentAt[`auth:${name}`];
		const newFailure =
			failedAt !== null &&
			failedAt !== undefined &&
			(lastAuth === undefined || failedAt > lastAuth);
		if (newFailure && canSend("auth", name)) {
			emit("auth", name);
		}

		const stall = stalls[name];
		if (source.health === "stalled") {
			const current = stall ?? { announced: false, since: now };
			if (canSend("stalled", name)) {
				emit("stalled", name);
				stalls[name] = { ...current, announced: true };
			} else {
				stalls[name] = current;
			}
			continue;
		}
		const recovered =
			stall !== undefined &&
			source.health === "ok" &&
			source.lastSuccessAt !== null &&
			source.lastSuccessAt > stall.since;
		if (recovered) {
			if (stall.announced) {
				emit("recovered", name);
			}
			delete stalls[name];
		}
	}
	return { next: { lastSentAt, stalls }, send };
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

const PEM_PKCS8 =
	/-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/;

/** PKCS#8 PEM(`BEGIN PRIVATE KEY`) → DER. 키 내용은 오류 메시지에 넣지 않는다. */
function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
	const m = PEM_PKCS8.exec(pem);
	if (!m) {
		throw new Error("FCM service account private_key must be a PKCS#8 PEM");
	}
	const binary = atob((m[1] as string).replace(WHITESPACE, ""));
	const der = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		der[i] = binary.charCodeAt(i);
	}
	return der;
}

interface ServiceAccount {
	clientEmail: string;
	privateKey: string;
}

function parseServiceAccount(json: string): ServiceAccount {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		// biome-ignore lint/style/useErrorCause: JSON.parse 오류 문구에 비밀 키 일부가 들어갈 수 있어 원래 오류를 버린다.
		throw new Error("FCM service account is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("FCM service account must be a JSON object");
	}
	const { client_email: clientEmail, private_key: privateKey } =
		parsed as Record<string, unknown>;
	if (typeof clientEmail !== "string" || clientEmail === "") {
		throw new Error("FCM service account is missing client_email");
	}
	if (typeof privateKey !== "string" || privateKey === "") {
		throw new Error("FCM service account is missing private_key");
	}
	return { clientEmail, privateKey };
}

/**
 * 서비스 계정으로 OAuth 액세스 토큰을 받는 요청. RS256 JWT를 WebCrypto로 서명해
 * `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`로 POST한다.
 */
export async function fcmAccessTokenRequest(
	serviceAccountJson: string,
	now: number
): Promise<Request> {
	const account = parseServiceAccount(serviceAccountJson);
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemToPkcs8(account.privateKey),
		{ hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
		false,
		["sign"]
	);
	const iat = Math.floor(now / 1000);
	const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
	const claims = base64UrlJson({
		aud: GOOGLE_TOKEN_URL,
		exp: iat + JWT_LIFETIME_S,
		iat,
		iss: account.clientEmail,
		scope: FCM_SCOPE,
	});
	const signingInput = `${header}.${claims}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(signingInput)
	);
	const assertion = `${signingInput}.${base64Url(new Uint8Array(signature))}`;
	return new Request(GOOGLE_TOKEN_URL, {
		body: new URLSearchParams({
			assertion,
			grant_type: JWT_BEARER_GRANT,
		}).toString(),
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		method: "POST",
	});
}

/** FCM HTTP v1 메시지 한 건(기기 토큰 하나, 알림 제목·본문). */
export function fcmSendRequest(
	projectId: string,
	accessToken: string,
	deviceToken: string,
	title: string,
	body: string
): Request {
	return new Request(
		`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
		{
			body: JSON.stringify({
				message: {
					android: { priority: "high" },
					notification: { body, title },
					token: deviceToken,
				},
			}),
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json; charset=utf-8",
			},
			method: "POST",
		}
	);
}

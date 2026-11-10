import type { Database } from "@Betro/db";
import { install } from "@Betro/db/schema/commute";
import { eq } from "drizzle-orm";

export const INSTALL_HEADER = "X-Betro-Install";

const BEARER_PREFIX = "Bearer ";
const MS_PER_DAY = 86_400_000;
const HEX_RADIX = 16;
const HEX_WIDTH = 2;

export interface PushTokenRow {
	activityId: string;
	env: "sandbox" | "production";
	id: number;
	installId: string;
	kind: "apns-start" | "apns-activity" | "fcm";
	sessionId: string;
	token: string;
	updatedAt: number;
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text)
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(HEX_RADIX).padStart(HEX_WIDTH, "0")
	).join("");
}

/** 길이가 같은 두 문자열을 시간 차이 없이 비교한다. 길이가 다르면 바로 거짓. */
export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let mismatches = 0;
	for (let i = 0; i < a.length; i += 1) {
		if (a.charCodeAt(i) !== b.charCodeAt(i)) {
			mismatches += 1;
		}
	}
	return mismatches === 0;
}

/**
 * `X-Betro-Install`과 `Authorization: Bearer <secret>`로 설치를 확인한다.
 * 모르는 설치와 틀린 비밀값을 구분하지 않고 둘 다 null.
 */
export async function authenticateInstall(
	db: Database,
	headers: Headers,
	now: number = Date.now()
): Promise<{ installId: string } | null> {
	const installId = headers.get(INSTALL_HEADER);
	const authorization = headers.get("Authorization");
	if (!(installId && authorization?.startsWith(BEARER_PREFIX))) {
		return null;
	}
	const secret = authorization.slice(BEARER_PREFIX.length);
	if (!secret) {
		return null;
	}
	const [row] = await db
		.select({
			lastSeenAt: install.lastSeenAt,
			secretHash: install.secretHash,
		})
		.from(install)
		.where(eq(install.id, installId))
		.limit(1);
	// 모르는 설치도 같은 해시 계산을 거쳐 응답 시간 차이를 줄인다.
	const hash = await sha256Hex(secret);
	if (!(row && constantTimeEqual(hash, row.secretHash))) {
		return null;
	}
	if (now - row.lastSeenAt >= MS_PER_DAY) {
		await db
			.update(install)
			.set({ lastSeenAt: now })
			.where(eq(install.id, installId));
	}
	return { installId };
}

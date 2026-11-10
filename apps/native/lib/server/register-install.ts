import type { InstallIdentity } from "@/lib/device/install-identity";

import type { ServerClient } from "./api-client";

export type RegisterResult = "registered" | "already" | "conflict" | "offline";

export interface RegisterInstallDeps {
	client: ServerClient;
	hash: (text: string) => Promise<string>;
	identity: InstallIdentity;
	platform: "ios" | "android";
	/** 등록한 서버. 저장해 두는 표시에 함께 넣어, 다른 서버를 가리키면 다시 등록한다. */
	serverUrl: string;
	store: {
		get: () => Promise<string | null>;
		set: (value: string) => Promise<void>;
	};
}

const STATUS_OK = 200;
const STATUS_CREATED = 201;
const STATUS_UNAUTHORIZED = 401;
const STATUS_CONFLICT = 409;
const TRAILING_SLASHES = /\/+$/;

function registrationMarker(serverUrl: string, installId: string): string {
	return `${serverUrl.trim().replace(TRAILING_SLASHES, "")}|${installId}`;
}

/**
 * 서버에 설치를 알린다. 비밀값 원문은 보내지 않고 해시만 보낸다.
 * 한 번 성공하면 서버 주소와 설치 ID를 저장해 다음 실행에서는 요청하지 않는다.
 */
export async function registerInstall(
	deps: RegisterInstallDeps
): Promise<RegisterResult> {
	const { client, hash, identity, platform, serverUrl, store } = deps;
	const marker = registrationMarker(serverUrl, identity.installId);
	if ((await store.get()) === marker) {
		return "already";
	}
	const secretHash = await hash(identity.secret);
	const { status } = await client.request("POST", "/v1/installs", {
		installId: identity.installId,
		platform,
		secretHash,
	});
	if (status === STATUS_OK || status === STATUS_CREATED) {
		await store.set(marker);
		return "registered";
	}
	if (status === STATUS_CONFLICT) {
		return "conflict";
	}
	return "offline";
}

/**
 * 서버가 401로 설치를 모른다고 하면(설치 삭제, DB 초기화) 등록 표시를 지워 다음 실행에서 다시 등록한다.
 * 표시를 지우지 못해도 응답은 그대로 돌려준다.
 */
export function withRegistrationReset(
	client: ServerClient,
	clear: () => Promise<void>
): ServerClient {
	return {
		async request(method, path, body) {
			const response = await client.request(method, path, body);
			if (response.status === STATUS_UNAUTHORIZED) {
				try {
					await clear();
				} catch {
					// 다음 401에서 다시 지운다.
				}
			}
			return response;
		},
	};
}

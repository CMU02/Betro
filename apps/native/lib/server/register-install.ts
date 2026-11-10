import type { InstallIdentity } from "@/lib/device/install-identity";

import type { ServerClient } from "./api-client";

export type RegisterResult = "registered" | "already" | "conflict" | "offline";

export interface RegisterInstallDeps {
	client: ServerClient;
	hash: (text: string) => Promise<string>;
	identity: InstallIdentity;
	platform: "ios" | "android";
	store: {
		get: () => Promise<string | null>;
		set: (value: string) => Promise<void>;
	};
}

const STATUS_OK = 200;
const STATUS_CREATED = 201;
const STATUS_CONFLICT = 409;

/**
 * 서버에 설치를 알린다. 비밀값 원문은 보내지 않고 해시만 보낸다.
 * 한 번 성공하면 설치 ID를 저장해 다음 실행에서는 요청하지 않는다.
 */
export async function registerInstall(
	deps: RegisterInstallDeps
): Promise<RegisterResult> {
	const { client, hash, identity, platform, store } = deps;
	if ((await store.get()) === identity.installId) {
		return "already";
	}
	const secretHash = await hash(identity.secret);
	const { status } = await client.request("POST", "/v1/installs", {
		installId: identity.installId,
		platform,
		secretHash,
	});
	if (status === STATUS_OK || status === STATUS_CREATED) {
		await store.set(identity.installId);
		return "registered";
	}
	if (status === STATUS_CONFLICT) {
		return "conflict";
	}
	return "offline";
}

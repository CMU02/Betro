import { getRandomBytes, randomUUID } from "expo-crypto";
import {
	AFTER_FIRST_UNLOCK,
	getItemAsync,
	setItemAsync,
} from "expo-secure-store";

import {
	getOrCreateInstallIdentity,
	type InstallIdentity,
} from "./install-identity";

/**
 * 잠금 상태의 백그라운드 실행(push-to-start 토큰 갱신, 출퇴근 푸시 처리)에서도 비밀값을 읽어 서버에
 * 인증할 수 있게 한다. iOS 기본값(WHEN_UNLOCKED)은 잠긴 동안 읽기가 실패한다. 이미 저장된 항목의
 * 접근 속성은 다시 써야만 바뀌므로 첫 출시 전에 정해 둔다. Android는 이 옵션을 무시한다.
 */
const SECURE_STORE_OPTIONS = {
	keychainAccessible: AFTER_FIRST_UNLOCK,
} as const;

let pending: Promise<InstallIdentity> | null = null;

/** 동시 호출은 진행 중인 하나의 Promise를 공유하고, 실패하면 다음 호출에서 다시 시도한다. */
export function ensureInstallIdentity(): Promise<InstallIdentity> {
	if (pending) {
		return pending;
	}
	const attempt = createIdentity();
	pending = attempt;
	attempt.catch(() => {
		if (pending === attempt) {
			pending = null;
		}
	});
	return attempt;
}

function createIdentity(): Promise<InstallIdentity> {
	return getOrCreateInstallIdentity(
		{
			getItem: (key) => getItemAsync(key, SECURE_STORE_OPTIONS),
			setItem: (key, value) => setItemAsync(key, value, SECURE_STORE_OPTIONS),
		},
		{
			bytes: (length) => getRandomBytes(length),
			uuid: () => randomUUID(),
		}
	);
}

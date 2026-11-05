import { getRandomBytes, randomUUID } from "expo-crypto";
import { getItemAsync, setItemAsync } from "expo-secure-store";

import {
	getOrCreateInstallIdentity,
	type InstallIdentity,
} from "./install-identity";

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
			getItem: (key) => getItemAsync(key),
			setItem: (key, value) => setItemAsync(key, value),
		},
		{
			bytes: (length) => getRandomBytes(length),
			uuid: () => randomUUID(),
		}
	);
}

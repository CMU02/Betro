import {
	CryptoDigestAlgorithm,
	CryptoEncoding,
	digestStringAsync,
} from "expo-crypto";
import Storage from "expo-sqlite/kv-store";
import { Platform } from "react-native";

import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import { reportError } from "@/lib/crash/crash-reporting";
import { ensureInstallIdentity } from "@/lib/device/app-install-identity";
import { ENV } from "@/src/env";

import { createServerClient, type ServerClient } from "./api-client";
import { registerInstall } from "./register-install";

const REGISTERED_INSTALL_KEY = "betro.registeredInstallId";

export const serverClient: ServerClient = createServerClient({
	baseUrl: ENV.EXPO_PUBLIC_SERVER_URL,
	fetch,
	identity: ensureInstallIdentity,
});

const registeredInstallStore = {
	get: () => Storage.getItem(REGISTERED_INSTALL_KEY),
	set: (value: string) => Storage.setItem(REGISTERED_INSTALL_KEY, value),
};

/**
 * 앱 시작 때 설치를 서버에 등록한다. 실패해도 앱은 계속 쓰고 다음 실행에 다시 시도한다.
 * 비밀값, 서버 주소는 기록하지 않는다.
 */
export async function ensureRegistered(): Promise<void> {
	try {
		const identity = await ensureInstallIdentity();
		const platform = Platform.OS === "ios" ? "ios" : "android";
		const result = await registerInstall({
			client: serverClient,
			hash: (text) =>
				digestStringAsync(CryptoDigestAlgorithm.SHA256, text, {
					encoding: CryptoEncoding.HEX,
				}),
			identity,
			platform,
			store: registeredInstallStore,
		});
		if (result === "conflict") {
			reportError(
				appCrashSink,
				new Error("install registration conflict"),
				"register-install"
			);
		}
	} catch (error) {
		reportError(appCrashSink, error, "register-install");
	}
}

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
import {
	type RegisterResult,
	registerInstall,
	withRegistrationReset,
} from "./register-install";

const REGISTERED_INSTALL_KEY = "betro.registeredInstallId";

const registeredInstallStore = {
	clear: () => Storage.removeItem(REGISTERED_INSTALL_KEY),
	get: () => Storage.getItem(REGISTERED_INSTALL_KEY),
	set: (value: string) => Storage.setItem(REGISTERED_INSTALL_KEY, value),
};

/** 서버가 401로 설치를 모른다고 하면 등록 표시를 지워 다음 실행에서 다시 등록한다. */
export const serverClient: ServerClient = withRegistrationReset(
	createServerClient({
		baseUrl: ENV.EXPO_PUBLIC_SERVER_URL,
		fetch,
		identity: ensureInstallIdentity,
	}),
	registeredInstallStore.clear
);

/**
 * 설치를 서버에 등록하고 결과를 돌려준다. 실패해도 던지지 않고 기록만 하며(`"error"`),
 * 호출하는 쪽이 다시 시도한다. 비밀값, 서버 주소는 기록하지 않는다.
 */
export async function ensureRegistered(): Promise<RegisterResult | "error"> {
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
			serverUrl: ENV.EXPO_PUBLIC_SERVER_URL,
			store: registeredInstallStore,
		});
		if (result === "conflict") {
			reportError(
				appCrashSink,
				new Error("install registration conflict"),
				"register-install"
			);
		}
		return result;
	} catch (error) {
		reportError(appCrashSink, error, "register-install");
		return "error";
	}
}

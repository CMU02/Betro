import { Platform } from "react-native";

import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import { reportError } from "@/lib/crash/crash-reporting";
import { t } from "@/lib/i18n/t";
import { appPlaces } from "@/lib/places/app-places";
import { planHeaderOf } from "@/lib/places/plan-headers";
import { ensureRegistered, serverClient } from "@/lib/server/app-server";
import { CommuteNotification } from "@/modules/commute-notification";
import { handleCommuteAction, registerFcmToken } from "./handle-commute-action";
import {
	type CommuteMessageResult,
	handleCommuteMessage,
} from "./handle-commute-message";

/** 앱 진입 파일이 등록하는 헤드리스 태스크 이름. Kotlin `CommuteActionTaskService`와 같다. */
export const COMMUTE_ACTION_TASK = "CommuteAction";

function deviceTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Android에서 출퇴근 FCM 데이터 메시지를 처리한다. 다른 플랫폼이나 모듈이 없으면 무시한다. */
export async function handleAppCommuteMessage(
	data: Record<string, string>
): Promise<CommuteMessageResult> {
	const notifier = CommuteNotification;
	if (Platform.OS !== "android" || notifier === null) {
		return "ignored";
	}
	try {
		return await handleCommuteMessage(data, {
			client: serverClient,
			header: (planId) =>
				Promise.resolve(planHeaderOf(planId, appPlaces.get(), t)),
			notifier,
			now: Date.now,
			t,
			timezone: deviceTimezone(),
		});
	} catch (error) {
		reportError(appCrashSink, error, "commute-message");
		return "ignored";
	}
}

/** 알림의 "종료"(헤드리스 태스크). 던지지 않는다. */
export async function runCommuteAction(data: {
	kind?: unknown;
	sessionId?: unknown;
}): Promise<void> {
	const notifier = CommuteNotification;
	if (
		notifier === null ||
		data.kind !== "end" ||
		typeof data.sessionId !== "string"
	) {
		return;
	}
	try {
		await handleCommuteAction(
			{ kind: "end", sessionId: data.sessionId },
			{ client: serverClient, notifier }
		);
	} catch (error) {
		reportError(appCrashSink, error, "commute-action");
	}
}

/** 설치 등록이 끝난 뒤 Android FCM 토큰을 서버에 보낸다. 실패해도 던지지 않고 다음 실행에서 다시 보낸다. */
export async function registerAppFcmToken(token: string): Promise<void> {
	if (Platform.OS !== "android") {
		return;
	}
	try {
		const registered = await ensureRegistered();
		if (registered === "registered" || registered === "already") {
			await registerFcmToken(serverClient, token);
		}
	} catch (error) {
		reportError(appCrashSink, error, "fcm-token");
	}
}

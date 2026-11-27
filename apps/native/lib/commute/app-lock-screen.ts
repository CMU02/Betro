import { AppState, Linking, Platform } from "react-native";

import { appCrashSink } from "@/lib/crash/app-crash-reporting";
import { reportError } from "@/lib/crash/crash-reporting";
import type { PermissionStatus } from "@/lib/onboarding/onboarding";
import { requestNotificationPermission } from "@/lib/permissions/permissions";
import { appPlacesSync } from "@/lib/places/app-places";
import { appPreferences } from "@/lib/preferences/app-preferences";
import { getPushPermissionStatus } from "@/lib/push/push-messaging";
import { CommuteActivity } from "@/modules/commute-activity";
import { CommuteNotification } from "@/modules/commute-notification";

import {
	endLocalGuidance,
	setLockScreenGuidance,
} from "./lock-screen-guidance";
import type { LockScreenPlatform } from "./lock-screen-readiness";
import { createLockScreenStatusStore } from "./lock-screen-status";

export const lockScreenPlatform: LockScreenPlatform =
	Platform.OS === "ios" ? "ios" : "android";

/** 앱 전체가 쓰는 잠금화면 시스템 상태 하나. 앱이 앞으로 올 때(설정 앱에서 돌아올 때) 다시 읽는다. */
export const appLockScreenStatus = createLockScreenStatusStore({
	readActivitiesEnabled: () => CommuteActivity.areActivitiesEnabled(),
	readPushStatus: getPushPermissionStatus,
});

AppState.addEventListener("change", (state) => {
	if (state === "active") {
		appLockScreenStatus.refresh().catch(() => undefined);
	}
});

/** 설정의 "출퇴근 잠금화면 안내"를 바꾼다. 던지지 않는다. */
export function setAppLockScreenGuidance(enabled: boolean): Promise<void> {
	return setLockScreenGuidance(enabled, {
		endLocal: () =>
			endLocalGuidance(lockScreenPlatform, {
				endActivities: () => CommuteActivity.endAll(),
				notifier: CommuteNotification,
			}),
		sync: () => appPlacesSync.run(),
		update: (value) =>
			appPreferences.update({ commuteLiveActivityEnabled: value }),
	}).catch((error: unknown) => {
		reportError(appCrashSink, error, "lock-screen-guidance");
	});
}

/** 알림 권한을 묻고 상태를 다시 읽는다(허용되면 푸시 구독이 다시 시작돼 FCM 토큰을 올린다). */
export async function requestLockScreenNotifications(): Promise<PermissionStatus> {
	let status: PermissionStatus = "denied";
	try {
		status = await requestNotificationPermission();
	} catch (error) {
		reportError(appCrashSink, error, "lock-screen-permission");
	}
	await appLockScreenStatus.refresh();
	return status;
}

/** 이 앱의 시스템 설정(알림, 실시간 현황)을 연다. 돌아오면 앞으로 올 때 상태를 다시 읽는다. */
export function openLockScreenSystemSettings(): void {
	Linking.openSettings().catch(() => undefined);
}

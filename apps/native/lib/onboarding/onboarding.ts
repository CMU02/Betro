import type { Preferences } from "@/lib/preferences/preferences";
import type { PreferencesStore } from "@/lib/preferences/preferences-store";

export type PermissionStatus = "granted" | "denied" | "undetermined";

export interface PermissionsState {
	location: PermissionStatus;
	notifications: PermissionStatus;
}

/** 권한 카드 버튼을 눌렀을 때 할 일. */
export type PermissionButtonAction = "request" | "openSettings" | "none";

/**
 * 영구 거부(iOS 거부 뒤, Android "다시 묻지 않음")면 요청해도 창 없이 바로 거부가 온다.
 * 상태만으로는 구분할 수 없으므로(Android 13+는 묻기 전에도 "denied"),
 * 이번 화면에서 요청한 결과가 거부였을 때만 설정 앱으로 보낸다.
 */
export function permissionButtonAction(
	status: PermissionStatus,
	requestedThisSession: boolean
): PermissionButtonAction {
	if (status === "granted") {
		return "none";
	}
	return status === "denied" && requestedThisSession
		? "openSettings"
		: "request";
}

/**
 * 권한 화면의 "계속"과 "나중에"가 부른다. 권한이 없어도 지도는 볼 수 있어야 하므로
 * 권한 상태를 받지 않고 항상 끝낸다.
 */
export function completeOnboarding(store: PreferencesStore): void {
	store.update({ onboardingCompleted: true });
}

export function shouldShowOnboarding(prefs: Preferences): boolean {
	return !prefs.onboardingCompleted;
}

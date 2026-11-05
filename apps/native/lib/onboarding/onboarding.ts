import type { Preferences } from "@/lib/preferences/preferences";
import type { PreferencesStore } from "@/lib/preferences/preferences-store";

export type PermissionStatus = "granted" | "denied" | "undetermined";

export interface PermissionsState {
	location: PermissionStatus;
	notifications: PermissionStatus;
}

/**
 * 권한 화면의 "계속"과 "나중에"는 권한 결과와 상관없이 앱으로 간다.
 * 권한이 없어도 지도는 볼 수 있어야 하므로 이 규칙을 이름으로 남긴다.
 */
export function canSkipToApp(_state: PermissionsState): true {
	return true;
}

export function completeOnboarding(store: PreferencesStore): void {
	store.update({ onboardingCompleted: true });
}

export function shouldShowOnboarding(prefs: Preferences): boolean {
	return !prefs.onboardingCompleted;
}

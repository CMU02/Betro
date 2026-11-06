import {
	getForegroundPermissionsAsync,
	requestForegroundPermissionsAsync,
} from "expo-location";

import type {
	PermissionStatus,
	PermissionsState,
} from "@/lib/onboarding/onboarding";
import {
	getPushPermissionStatus,
	requestPushPermission,
} from "@/lib/push/push-messaging";

/** 사용 중 위치 권한을 묻는다. 시스템 창이 뜨는 동작이라 사용자가 누른 버튼에서만 부른다. */
export async function requestLocationPermission(): Promise<PermissionStatus> {
	const { status } = await requestForegroundPermissionsAsync();
	return status;
}

/** 알림 권한을 묻는다. iOS는 Firebase로 APNs 등록까지 한다. */
export function requestNotificationPermission(): Promise<PermissionStatus> {
	return requestPushPermission();
}

/** 창을 띄우지 않고 지금 권한 상태만 읽는다. */
export async function getPermissionsState(): Promise<PermissionsState> {
	const [location, notifications] = await Promise.all([
		getForegroundPermissionsAsync().then(({ status }) => status),
		getPushPermissionStatus(),
	]);
	return { location, notifications };
}

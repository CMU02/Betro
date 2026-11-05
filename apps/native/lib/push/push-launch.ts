export interface PushSubscribeOptions {
	/** true면 구독 전에 알림 권한을 묻는다. false면 이미 허용된 경우에만 토큰을 받고 구독한다. */
	requestPermission: boolean;
}

/** "request": 시스템 권한 창을 띄운다. "check": 창 없이 현재 상태만 읽는다. */
export type PushPermissionStep = "request" | "check";

/** `usePushNotifications`가 구독 전에 권한을 물을지, 상태만 읽을지 정한다. */
export function permissionStepFor(
	options: PushSubscribeOptions
): PushPermissionStep {
	return options.requestPermission ? "request" : "check";
}

/**
 * 앱을 켤 때 쓰는 푸시 구독 옵션. 알림 권한은 온보딩 권한 화면에서만 묻고,
 * "나중에"를 고른 사람에게 앱을 다시 켤 때마다 시스템 창을 띄우지 않는다.
 */
export function subscribeOptionsForLaunch(): { requestPermission: false } {
	return { requestPermission: false };
}

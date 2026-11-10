import {
	getInitialNotification,
	getMessaging,
	getToken,
	hasPermission,
	onMessage,
	onNotificationOpenedApp,
	onTokenRefresh,
	requestPermission,
} from "@react-native-firebase/messaging";
import { PermissionsAndroid, Platform } from "react-native";

import type { PermissionStatus } from "@/lib/onboarding/onboarding";

import {
	type PushMessage,
	toPermissionStatus,
	toPushMessage,
} from "./push-message";

/** Android 13 (API 33) introduced the runtime POST_NOTIFICATIONS permission. */
const ANDROID_RUNTIME_NOTIFICATION_PERMISSION_API = 33;

export interface PushSubscriptionHandlers {
	/** Message arrived while the app was in the foreground. FCM shows no banner here. */
	onForegroundMessage?: (message: PushMessage) => void;
	/** User tapped a notification. `fromQuitState` is true when the tap launched the app. */
	onNotificationOpened?: (message: PushMessage, fromQuitState: boolean) => void;
	/** FCM rotated the registration token. Re-send it to the server. */
	onTokenRefresh?: (token: string) => void;
}

function androidApiLevel(): number {
	return typeof Platform.Version === "number"
		? Platform.Version
		: Number(Platform.Version);
}

async function requestAndroidPermission(): Promise<PermissionStatus> {
	if (androidApiLevel() < ANDROID_RUNTIME_NOTIFICATION_PERMISSION_API) {
		// Android 12 이하는 런타임 권한이 없다. 사용자가 시스템 설정에서 끈 경우만 거부로 본다.
		return getPushPermissionStatus();
	}
	const result = await PermissionsAndroid.request(
		PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
	);
	return result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
}

/**
 * Current notification permission without showing any dialog.
 * iOS reports all three states. Android only reports whether notifications are enabled,
 * so "not asked yet" on Android 13+ comes back as "denied".
 */
export async function getPushPermissionStatus(): Promise<PermissionStatus> {
	return toPermissionStatus(await hasPermission(getMessaging()));
}

/**
 * Asks the user for notification permission on both platforms. Call it only from a
 * user action (the onboarding permission screen), never on launch.
 * iOS goes through Firebase (which also registers with APNs). Android 13+ uses the
 * runtime permission dialog and older Android grants implicitly.
 */
export async function requestPushPermission(): Promise<PermissionStatus> {
	if (Platform.OS === "ios") {
		return toPermissionStatus(await requestPermission(getMessaging()));
	}
	return requestAndroidPermission();
}

/** Returns the FCM registration token for this install. */
export function getPushToken(): Promise<string> {
	return getToken(getMessaging());
}

/**
 * Wires the foreground, tap and token-refresh listeners and replays the notification
 * that launched the app (if any). Returns a function that removes every listener.
 */
export function subscribeToPushMessages(
	handlers: PushSubscriptionHandlers
): () => void {
	const messaging = getMessaging();
	const unsubscribers: Array<() => void> = [];

	if (handlers.onForegroundMessage) {
		const handler = handlers.onForegroundMessage;
		unsubscribers.push(
			onMessage(messaging, (message) => handler(toPushMessage(message)))
		);
	}
	if (handlers.onNotificationOpened) {
		const handler = handlers.onNotificationOpened;
		unsubscribers.push(
			onNotificationOpenedApp(messaging, (message) =>
				handler(toPushMessage(message), false)
			)
		);
		getInitialNotification(messaging)
			.then((message) => {
				if (message) {
					handler(toPushMessage(message), true);
				}
			})
			.catch(() => {
				// No launch notification, or the native module was not ready. Nothing to replay.
			});
	}
	if (handlers.onTokenRefresh) {
		unsubscribers.push(onTokenRefresh(messaging, handlers.onTokenRefresh));
	}

	return () => {
		for (const unsubscribe of unsubscribers) {
			unsubscribe();
		}
	};
}

import {
	getInitialNotification,
	getMessaging,
	getToken,
	onMessage,
	onNotificationOpenedApp,
	onTokenRefresh,
	requestPermission,
} from "@react-native-firebase/messaging";
import { PermissionsAndroid, Platform } from "react-native";

import {
	isPushAuthorized,
	type PushMessage,
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

async function requestAndroidPermission(): Promise<boolean> {
	if (Platform.OS !== "android") {
		return true;
	}
	const apiLevel =
		typeof Platform.Version === "number"
			? Platform.Version
			: Number(Platform.Version);
	if (apiLevel < ANDROID_RUNTIME_NOTIFICATION_PERMISSION_API) {
		return true;
	}
	const result = await PermissionsAndroid.request(
		PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
	);
	return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Asks the user for notification permission on both platforms.
 * iOS goes through Firebase (which also registers with APNs). Android 13+ uses the
 * runtime permission dialog and older Android grants implicitly.
 */
export async function requestPushPermission(): Promise<boolean> {
	if (Platform.OS === "ios") {
		const status = await requestPermission(getMessaging());
		return isPushAuthorized(status);
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

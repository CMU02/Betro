import { useEffect, useState } from "react";

import type { PushSubscribeOptions } from "./push-launch";
import type { PushMessage } from "./push-message";
import {
	getPushPermissionStatus,
	getPushToken,
	type PushSubscriptionHandlers,
	requestPushPermission,
	subscribeToPushMessages,
} from "./push-messaging";

/** "checking": 권한 확인 중. "denied": 허용되지 않음(아직 묻지 않은 경우 포함). */
export type PushPermissionState = "checking" | "granted" | "denied" | "error";

export interface PushNotificationsState {
	/** Most recent message received while the app was in the foreground. */
	lastForegroundMessage: PushMessage | null;
	/** Most recent notification the user tapped to open the app. */
	lastOpenedMessage: PushMessage | null;
	permission: PushPermissionState;
	/** FCM registration token, available once permission is granted. */
	token: string | null;
}

const INITIAL_STATE: PushNotificationsState = {
	lastForegroundMessage: null,
	lastOpenedMessage: null,
	permission: "checking",
	token: null,
};

/**
 * Checks notification permission on mount (asking only when `options.requestPermission`
 * is true), fetches the FCM token once granted and keeps the foreground, tap and
 * token-refresh listeners alive while the component is mounted.
 */
export function usePushNotifications(
	handlers: PushSubscriptionHandlers,
	options: PushSubscribeOptions
): PushNotificationsState {
	const [state, setState] = useState<PushNotificationsState>(INITIAL_STATE);
	const { onForegroundMessage, onNotificationOpened, onTokenRefresh } =
		handlers;
	const { requestPermission } = options;

	useEffect(() => {
		let cancelled = false;
		let unsubscribe: (() => void) | null = null;

		const start = async () => {
			const status = requestPermission
				? await requestPushPermission()
				: await getPushPermissionStatus();
			if (cancelled) {
				return;
			}
			if (status !== "granted") {
				setState((previous) => ({ ...previous, permission: "denied" }));
				return;
			}
			const token = await getPushToken();
			if (cancelled) {
				return;
			}
			setState((previous) => ({ ...previous, permission: "granted", token }));
			unsubscribe = subscribeToPushMessages({
				onForegroundMessage: (message) => {
					setState((previous) => ({
						...previous,
						lastForegroundMessage: message,
					}));
					onForegroundMessage?.(message);
				},
				onNotificationOpened: (message, fromQuitState) => {
					setState((previous) => ({ ...previous, lastOpenedMessage: message }));
					onNotificationOpened?.(message, fromQuitState);
				},
				onTokenRefresh: (refreshed) => {
					setState((previous) => ({ ...previous, token: refreshed }));
					onTokenRefresh?.(refreshed);
				},
			});
		};

		start().catch(() => {
			if (!cancelled) {
				setState((previous) => ({ ...previous, permission: "error" }));
			}
		});

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [
		onForegroundMessage,
		onNotificationOpened,
		onTokenRefresh,
		requestPermission,
	]);

	return state;
}

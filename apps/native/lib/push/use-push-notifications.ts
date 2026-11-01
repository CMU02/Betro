import { useEffect, useState } from "react";

import type { PushMessage } from "./push-message";
import {
	getPushToken,
	type PushSubscriptionHandlers,
	requestPushPermission,
	subscribeToPushMessages,
} from "./push-messaging";

export type PushPermissionState = "requesting" | "granted" | "denied" | "error";

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
	permission: "requesting",
	token: null,
};

/**
 * Requests notification permission once on mount, fetches the FCM token and keeps the
 * foreground, tap and token-refresh listeners alive while the component is mounted.
 */
export function usePushNotifications(
	handlers: PushSubscriptionHandlers = {}
): PushNotificationsState {
	const [state, setState] = useState<PushNotificationsState>(INITIAL_STATE);
	const { onForegroundMessage, onNotificationOpened, onTokenRefresh } =
		handlers;

	useEffect(() => {
		let cancelled = false;
		let unsubscribe: (() => void) | null = null;

		const start = async () => {
			const granted = await requestPushPermission();
			if (cancelled) {
				return;
			}
			if (!granted) {
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
	}, [onForegroundMessage, onNotificationOpened, onTokenRefresh]);

	return state;
}

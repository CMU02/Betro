import { useCallback, useEffect } from "react";
import { Alert } from "react-native";

import type { PushMessage } from "@/lib/push/push-message";
import { usePushNotifications } from "@/lib/push/use-push-notifications";

/**
 * Mounts FCM for the whole app: asks permission, fetches the token and shows foreground
 * messages as an alert (FCM does not render a banner while the app is open).
 * Renders nothing. Keep it inside the provider tree so navigation hooks work later.
 */
export function PushNotifications() {
	const onForegroundMessage = useCallback((message: PushMessage) => {
		if (message.title || message.body) {
			Alert.alert(message.title ?? "알림", message.body ?? undefined);
		}
	}, []);

	const { lastOpenedMessage, permission, token } = usePushNotifications({
		onForegroundMessage,
	});

	useEffect(() => {
		if (__DEV__ && permission === "granted" && token) {
			// Paste this token into the Firebase console "Send test message" dialog.
			console.info("[push] FCM token", token);
		}
	}, [permission, token]);

	useEffect(() => {
		if (__DEV__ && lastOpenedMessage) {
			// Confirms a tapped notification reached the hook state during device testing.
			console.info(
				"[push] opened notification",
				lastOpenedMessage.id,
				lastOpenedMessage.title,
				lastOpenedMessage.body
			);
		}
	}, [lastOpenedMessage]);

	return null;
}

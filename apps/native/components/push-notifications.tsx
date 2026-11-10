import { useCallback, useEffect } from "react";
import { Alert } from "react-native";
import { t } from "@/lib/i18n/t";
import { subscribeOptionsForLaunch } from "@/lib/push/push-launch";
import type { PushMessage } from "@/lib/push/push-message";
import { usePushNotifications } from "@/lib/push/use-push-notifications";

const LAUNCH_OPTIONS = subscribeOptionsForLaunch();

/**
 * Mounts FCM for the whole app. It never asks for permission here (the onboarding
 * permission screen does); when permission is already granted it fetches the token and
 * shows foreground messages as an alert (FCM does not render a banner while the app is open).
 * Renders nothing. The root layout remounts it when onboarding completes so a permission
 * granted on that screen starts the subscription without a relaunch.
 */
export function PushNotifications() {
	const onForegroundMessage = useCallback((message: PushMessage) => {
		if (message.title || message.body) {
			Alert.alert(
				message.title ?? t("push.defaultTitle"),
				message.body ?? undefined
			);
		}
	}, []);

	const { lastOpenedMessage, permission, token } = usePushNotifications(
		{ onForegroundMessage },
		LAUNCH_OPTIONS
	);

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

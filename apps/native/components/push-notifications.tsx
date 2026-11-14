import { useCallback, useEffect } from "react";
import { Alert } from "react-native";
import {
	handleAppCommuteMessage,
	registerAppFcmToken,
} from "@/lib/commute/app-commute";
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
		if (message.data.type === "commute") {
			// 앱이 앞에 있어도 출퇴근 메시지는 알림창에 그린다(Android). 알림 대화상자는 띄우지 않는다.
			handleAppCommuteMessage(message.data).catch(() => undefined);
			return;
		}
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
		if (permission === "granted" && token) {
			// Android만 보낸다(iOS는 네이티브 토큰 보고가 맡는다). 갱신된 토큰도 이 효과로 다시 보낸다.
			registerAppFcmToken(token).catch(() => undefined);
		}
	}, [permission, token]);

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

import { useCallback, useEffect } from "react";
import { Alert, AppState } from "react-native";
import {
	handleAppCommuteMessage,
	registerAppFcmToken,
} from "@/lib/commute/app-commute";
import { useLockScreenSystem } from "@/lib/commute/use-lock-screen";
import { t } from "@/lib/i18n/t";
import { appReachability } from "@/lib/network/app-reachability";
import { onReconnect } from "@/lib/network/reachability";
import { subscribeOptionsForLaunch } from "@/lib/push/push-launch";
import type { PushMessage } from "@/lib/push/push-message";
import { usePushNotifications } from "@/lib/push/use-push-notifications";

const LAUNCH_OPTIONS = subscribeOptionsForLaunch();

/**
 * Mounts FCM for the whole app. It never asks for permission here (the onboarding
 * permission screen does); when permission is already granted it fetches the token and
 * shows foreground messages as an alert (FCM does not render a banner while the app is open).
 * Renders nothing. The root layout remounts it when onboarding completes so a permission
 * granted on that screen starts the subscription without a relaunch. A permission granted
 * later (the sheet after saving a place, or the system settings app) restarts it through
 * the shared lock-screen status, so the FCM token reaches the server without a relaunch.
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

	const system = useLockScreenSystem();
	const { lastOpenedMessage, permission, token } = usePushNotifications(
		{ onForegroundMessage },
		LAUNCH_OPTIONS,
		system?.pushStatus ?? null
	);

	useEffect(() => {
		if (permission !== "granted" || !token) {
			return;
		}
		// Android만 보낸다(iOS는 네이티브 토큰 보고가 맡는다). 갱신된 토큰도 이 효과로 다시 보낸다.
		// 서버가 받기 전이면 앱이 앞으로 올 때와 연결이 돌아올 때 다시 보낸다(받은 뒤에는 보내지 않는다).
		const send = () => {
			registerAppFcmToken(token).catch(() => undefined);
		};
		send();
		const appState = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				send();
			}
		});
		const stopReconnect = onReconnect(appReachability, send);
		return () => {
			appState.remove();
			stopReconnect();
		};
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

import {
	getMessaging,
	setBackgroundMessageHandler,
} from "@react-native-firebase/messaging";

import { handleAppCommuteMessage } from "@/lib/commute/app-commute";

import { toPushMessage } from "./push-message";

/**
 * Runs headless (no UI, no React tree) when a data message arrives while the app is in the
 * background or killed. Must be registered from the app entry file before any React code.
 * FCM itself displays `notification` payloads in this state, so this only handles data.
 * 출퇴근 메시지(`type: "commute"`)는 Android 진행 중 알림으로 그린다.
 */
setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
	const message = toPushMessage(remoteMessage);
	if (message.data.type === "commute") {
		await handleAppCommuteMessage(message.data);
		return;
	}
	if (__DEV__) {
		console.info("[push] background message", message.id, message.data);
	}
});

import {
	getMessaging,
	setBackgroundMessageHandler,
} from "@react-native-firebase/messaging";

import { toPushMessage } from "./push-message";

/**
 * Runs headless (no UI, no React tree) when a data message arrives while the app is in the
 * background or killed. Must be registered from the app entry file before any React code.
 * FCM itself displays `notification` payloads in this state, so this only handles data.
 */
setBackgroundMessageHandler(getMessaging(), (remoteMessage) => {
	const message = toPushMessage(remoteMessage);
	if (__DEV__) {
		console.info("[push] background message", message.id, message.data);
	}
	return Promise.resolve();
});

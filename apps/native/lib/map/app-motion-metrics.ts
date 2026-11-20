import { captureMessage } from "@sentry/react-native";
import Storage from "expo-sqlite/kv-store";

import { createMotionMetrics } from "./motion-metrics";

/**
 * 앱 전체가 함께 쓰는 7.2 지표. 하루에 한 번 Sentry 메시지 `map-motion-daily`로 숫자만 보낸다.
 * Sentry가 시작되지 않았으면(DSN 없음) 아무것도 보내지 않는다.
 */
export const appMotionMetrics = createMotionMetrics(
	{
		getItem: (key) => Storage.getItemSync(key),
		setItem: (key, value) => {
			Storage.setItemSync(key, value);
		},
	},
	Date.now,
	({ backward, day, jump, ratio, updates }) => {
		captureMessage("map-motion-daily", {
			extra: { backward, day, jump, ratio, updates },
			level: "info",
			tags: { context: "map-motion" },
		});
	}
);

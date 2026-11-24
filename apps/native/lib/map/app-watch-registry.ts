import { useEffect } from "react";
import { AppState } from "react-native";

import { serverClient } from "@/lib/server/app-server";

import { postWatch } from "./map-client";
import { createPoller } from "./polling";
import {
	createWatchRegistry,
	WATCH_HEARTBEAT_MS,
	type WatchRegistry,
} from "./watch-registry";

/** 앱 하나의 관측 요청 창구. 관측 요청은 여기서만 보낸다. 노선 ref만 보내고 위치는 보내지 않는다. */
export const appWatchRegistry: WatchRegistry = createWatchRegistry(
	async (refs) => {
		const result = await postWatch(serverClient, refs);
		if (!result.ok) {
			// registry가 실패로 보고 다음 beat에 다시 보낸다.
			throw new Error(`watch failed: ${result.reason}`);
		}
	}
);

/**
 * 루트 레이아웃에서 한 번 부른다. 앱이 앞에 있는 동안 WATCH_HEARTBEAT_MS마다 beat한다.
 * 앱이 다시 앞으로 오면 기다리지 않고 바로 beat하고, 뒤에 있는 동안은 보내지 않는다.
 */
export function useWatchHeartbeat(): void {
	useEffect(() => {
		const poller = createPoller({
			intervalMs: WATCH_HEARTBEAT_MS,
			now: Date.now,
			run: () => appWatchRegistry.beat(),
			schedule: (fn, ms) => {
				const timer = setTimeout(fn, ms);
				return () => clearTimeout(timer);
			},
		});
		poller.setVisible(AppState.currentState === "active");
		const subscription = AppState.addEventListener("change", (state) => {
			poller.setVisible(state === "active");
		});
		return () => {
			subscription.remove();
			poller.dispose();
		};
	}, []);
}

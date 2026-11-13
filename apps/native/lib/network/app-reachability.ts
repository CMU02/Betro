import { useSyncExternalStore } from "react";

import { createReachability } from "./reachability";

/** 앱 전체가 쓰는 하나. 서버 클라이언트가 요청마다 알리고, 화면은 `useOffline`으로 읽는다. */
export const appReachability = createReachability();

/** 서버에 닿지 않으면 true. */
export function useOffline(): boolean {
	return useSyncExternalStore(
		appReachability.subscribe,
		appReachability.isOffline,
		appReachability.isOffline
	);
}

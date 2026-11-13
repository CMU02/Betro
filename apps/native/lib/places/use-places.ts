import { useSyncExternalStore } from "react";

import type { PlacesState } from "./places";
import type { PlacesStore } from "./places-store";

/** 장소 상태를 구독한다. 앱 전체가 쓰는 저장소는 호출하는 쪽이 넘긴다. */
export function usePlaces(store: PlacesStore): PlacesState {
	return useSyncExternalStore(store.subscribe, store.get);
}

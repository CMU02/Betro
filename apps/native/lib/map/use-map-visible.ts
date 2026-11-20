import { useIsFocused } from "expo-router";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

function subscribeAppState(onChange: () => void): () => void {
	const subscription = AppState.addEventListener("change", onChange);
	return () => subscription.remove();
}

function isAppActive(): boolean {
	return AppState.currentState === "active";
}

/**
 * 지도가 보이는 동안만 true다. 지도 탭이 포커스이고 앱이 앞에 있을 때다(지도 설계 4.5).
 * `useActiveSession`과 같은 판단이다.
 */
export function useMapVisible(): boolean {
	const focused = useIsFocused();
	const appActive = useSyncExternalStore(subscribeAppState, isAppActive);
	return focused && appActive;
}

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

/** 화면이 보이는 중인가. 포커스가 있고 앱이 앞에 있을 때만 true다. */
export function useScreenVisible(): boolean {
	const focused = useIsFocused();
	const appActive = useSyncExternalStore(subscribeAppState, isAppActive);
	return focused && appActive;
}

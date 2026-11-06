import { useCallback, useSyncExternalStore } from "react";

import { appPreferences } from "./app-preferences";
import type { Preferences } from "./preferences";
import type { PreferencesPatch } from "./preferences-store";

export function usePreferences(): [
	Preferences,
	(patch: PreferencesPatch) => void,
] {
	const preferences = useSyncExternalStore(
		appPreferences.subscribe,
		appPreferences.get
	);
	const update = useCallback((patch: PreferencesPatch) => {
		appPreferences.update(patch);
	}, []);
	return [preferences, update];
}

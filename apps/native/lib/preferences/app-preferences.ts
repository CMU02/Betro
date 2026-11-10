import Storage from "expo-sqlite/kv-store";

import { createPreferencesStore } from "./preferences-store";

export const appPreferences = createPreferencesStore({
	getItem: (key) => Storage.getItemSync(key),
	setItem: (key, value) => {
		Storage.setItemSync(key, value);
	},
});

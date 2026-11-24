import Storage from "expo-sqlite/kv-store";

import { createRecentsStore } from "./recents-store";

/** 앱 전체가 쓰는 최근 검색 저장소 하나. 서버에는 올리지 않는다(스펙 5.2). */
export const appRecents = createRecentsStore({
	getItem: (key) => Storage.getItemSync(key),
	setItem: (key, value) => {
		Storage.setItemSync(key, value);
	},
});

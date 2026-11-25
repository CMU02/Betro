import Storage from "expo-sqlite/kv-store";

import { createFavoritesStore } from "./favorites-store";

/** 앱 전체가 쓰는 즐겨찾기 저장소 하나. 서버에는 올리지 않는다(스펙 5.2). */
export const appFavorites = createFavoritesStore({
	getItem: (key) => Storage.getItemSync(key),
	setItem: (key, value) => {
		Storage.setItemSync(key, value);
	},
});

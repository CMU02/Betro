import type { SyncKeyValue } from "../preferences/preferences-store";
import {
	FAVORITES_KEY,
	type Favorite,
	parseFavorites,
	serializeFavorites,
} from "./favorites";

export interface FavoritesStore {
	get: () => Favorite[];
	has: (id: string) => boolean;
	remove: (id: string) => void;
	subscribe: (listener: () => void) => () => void;
	/** 있으면 지우고 false, 없으면 맨 앞에 더하고 true. */
	toggle: (favorite: Favorite) => boolean;
}

export function createFavoritesStore(kv: SyncKeyValue): FavoritesStore {
	let current: Favorite[] = [];
	try {
		current = parseFavorites(kv.getItem(FAVORITES_KEY));
	} catch {
		// 읽기 실패는 빈 목록으로 시작한다.
	}
	const listeners = new Set<() => void>();

	const commit = (next: Favorite[]) => {
		current = next;
		try {
			kv.setItem(FAVORITES_KEY, serializeFavorites(next));
		} catch {
			// 저장이 실패해도 이번 실행 동안은 메모리 값으로 동작한다.
		}
		for (const listener of listeners) {
			listener();
		}
	};

	const has = (id: string) => current.some((entry) => entry.id === id);

	return {
		get: () => current,
		has,
		remove: (id) => {
			if (has(id)) {
				commit(current.filter((entry) => entry.id !== id));
			}
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		toggle: (favorite) => {
			if (has(favorite.id)) {
				commit(current.filter((entry) => entry.id !== favorite.id));
				return false;
			}
			commit([favorite, ...current]);
			return true;
		},
	};
}

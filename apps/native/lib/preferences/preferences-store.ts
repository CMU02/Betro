import {
	PREFERENCES_KEY,
	type Preferences,
	parsePreferences,
} from "./preferences";

export interface SyncKeyValue {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

export type PreferencesPatch = Partial<Omit<Preferences, "version">>;

export interface PreferencesStore {
	get: () => Preferences;
	subscribe: (listener: () => void) => () => void;
	update: (patch: PreferencesPatch) => Preferences;
}

function readInitial(kv: SyncKeyValue): Preferences {
	try {
		return parsePreferences(kv.getItem(PREFERENCES_KEY));
	} catch {
		return parsePreferences(null);
	}
}

export function createPreferencesStore(kv: SyncKeyValue): PreferencesStore {
	let current = readInitial(kv);
	const listeners = new Set<() => void>();

	return {
		get: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		update(patch) {
			current = { ...current, ...patch };
			try {
				kv.setItem(PREFERENCES_KEY, JSON.stringify(current));
			} catch {
				// 저장이 실패해도 이번 실행 동안은 메모리 값으로 동작한다.
			}
			for (const listener of listeners) {
				listener();
			}
			return current;
		},
	};
}

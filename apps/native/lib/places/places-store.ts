import type { SyncKeyValue } from "../preferences/preferences-store";
import {
	emptyPlacesState,
	PLACES_KEY,
	type Place,
	type PlacesState,
	parsePlacesState,
	serializePlacesState,
} from "./places";

export interface PlacesStore {
	clearPendingDelete: (planId: string) => void;
	get: () => PlacesState;
	/** 올린 장소를 `synced`로 바꾼다. 그사이 고쳐져 `updatedAt`이 달라졌으면 그대로 둔다. */
	markSynced: (placeId: string, updatedAt: number) => void;
	/** 장소를 지우고 그 planId를 `pendingDeletes`에 넣는다. */
	remove: (placeId: string) => void;
	replace: (state: PlacesState) => void;
	subscribe: (listener: () => void) => () => void;
	/** 같은 id면 바꾸고 없으면 끝에 더한다. 그 planId가 지울 목록에 있으면 뺀다. */
	upsert: (place: Place) => void;
}

function readInitial(kv: SyncKeyValue): PlacesState {
	try {
		return parsePlacesState(kv.getItem(PLACES_KEY));
	} catch {
		return emptyPlacesState();
	}
}

function upserted(state: PlacesState, place: Place): PlacesState {
	const index = state.places.findIndex((entry) => entry.id === place.id);
	const places =
		index === -1
			? [...state.places, place]
			: state.places.map((entry, i) => (i === index ? place : entry));
	return {
		pendingDeletes: state.pendingDeletes.filter(
			(planId) => planId !== place.plan.planId
		),
		places,
	};
}

function removed(state: PlacesState, placeId: string): PlacesState {
	const target = state.places.find((entry) => entry.id === placeId);
	if (target === undefined) {
		return state;
	}
	const { planId } = target.plan;
	const pendingDeletes = state.pendingDeletes.includes(planId)
		? state.pendingDeletes
		: [...state.pendingDeletes, planId];
	return {
		pendingDeletes,
		places: state.places.filter((entry) => entry.id !== placeId),
	};
}

function synced(
	state: PlacesState,
	placeId: string,
	updatedAt: number
): PlacesState {
	return {
		...state,
		places: state.places.map((entry) =>
			entry.id === placeId && entry.updatedAt === updatedAt
				? { ...entry, sync: "synced" }
				: entry
		),
	};
}

export function createPlacesStore(kv: SyncKeyValue): PlacesStore {
	let current = readInitial(kv);
	let serialized = serializePlacesState(current);
	const listeners = new Set<() => void>();

	const commit = (next: PlacesState) => {
		const nextSerialized = serializePlacesState(next);
		if (nextSerialized === serialized) {
			return;
		}
		current = next;
		serialized = nextSerialized;
		try {
			kv.setItem(PLACES_KEY, nextSerialized);
		} catch {
			// 저장이 실패해도 이번 실행 동안은 메모리 값으로 동작한다.
		}
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		clearPendingDelete: (planId) => {
			commit({
				...current,
				pendingDeletes: current.pendingDeletes.filter((id) => id !== planId),
			});
		},
		get: () => current,
		markSynced: (placeId, updatedAt) => {
			commit(synced(current, placeId, updatedAt));
		},
		remove: (placeId) => {
			commit(removed(current, placeId));
		},
		replace: (state) => {
			commit(state);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		upsert: (place) => {
			commit(upserted(current, place));
		},
	};
}

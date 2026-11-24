import { z } from "zod";

import type { SyncKeyValue } from "../preferences/preferences-store";
import type { SearchTarget } from "./search-model";

export const RECENTS_KEY = "betro.search.recents";
export const RECENTS_MAX = 8;

export interface RecentsStore {
	add: (target: SearchTarget) => void;
	clear: () => void;
	get: () => SearchTarget[];
	subscribe: (listener: () => void) => () => void;
}

const targetSchema = z.discriminatedUnion("kind", [
	z.object({ key: z.string(), kind: z.literal("station"), name: z.string() }),
	z.object({ kind: z.literal("stop"), name: z.string(), stop: z.string() }),
	z.object({
		kind: z.literal("route"),
		line: z.string(),
		name: z.string(),
		shortName: z.string(),
	}),
]);

/** 경기·인천 출처 ID(스펙 3장: 일반 검색과 상세에 노출하지 않는다). */
const OUT_OF_SCOPE_ID = /(^|,)(gbis|tago):/;

function sameTarget(a: SearchTarget, b: SearchTarget): boolean {
	if (a.kind !== b.kind) {
		return false;
	}
	if (a.kind === "station" && b.kind === "station") {
		return a.key === b.key;
	}
	if (a.kind === "stop" && b.kind === "stop") {
		return a.stop === b.stop;
	}
	return a.kind === "route" && b.kind === "route" && a.line === b.line;
}

function idOf(target: SearchTarget): string {
	if (target.kind === "station") {
		return target.key;
	}
	return target.kind === "stop" ? target.stop : target.line;
}

/** 저장값을 읽는다. 깨졌거나 모양이 다르면 빈 목록이고, 경기·인천 대상은 버린다. */
function parseRecents(raw: string | null): SearchTarget[] {
	if (raw === null) {
		return [];
	}
	try {
		const list: unknown = JSON.parse(raw);
		if (!Array.isArray(list)) {
			return [];
		}
		const targets: SearchTarget[] = [];
		for (const entry of list) {
			const parsed = targetSchema.safeParse(entry);
			if (parsed.success && !OUT_OF_SCOPE_ID.test(idOf(parsed.data))) {
				targets.push(parsed.data);
			}
		}
		return targets.slice(0, RECENTS_MAX);
	} catch {
		return [];
	}
}

export function createRecentsStore(kv: SyncKeyValue): RecentsStore {
	let current: SearchTarget[] = [];
	try {
		current = parseRecents(kv.getItem(RECENTS_KEY));
	} catch {
		// 읽기 실패는 빈 목록으로 시작한다.
	}
	const listeners = new Set<() => void>();

	const commit = (next: SearchTarget[]) => {
		current = next;
		try {
			kv.setItem(RECENTS_KEY, JSON.stringify(next));
		} catch {
			// 저장이 실패해도 이번 실행 동안은 메모리 값으로 동작한다.
		}
		for (const listener of listeners) {
			listener();
		}
	};

	return {
		add: (target) => {
			commit(
				[
					target,
					...current.filter((entry) => !sameTarget(entry, target)),
				].slice(0, RECENTS_MAX)
			);
		},
		clear: () => {
			commit([]);
		},
		get: () => current,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

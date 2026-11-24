import { z } from "zod";

export const FAVORITES_KEY = "betro.favorites";

export type Favorite =
	| {
			addedAt: number;
			id: string;
			kind: "station";
			members: { line: string; stop: string }[];
			name: string;
	  }
	| {
			addedAt: number;
			arsId: string | null;
			id: string;
			kind: "stop";
			name: string;
			stop: string;
			towards: string | null;
	  }
	| {
			addedAt: number;
			id: string;
			kind: "route";
			line: string;
			name: string;
			routeType: string;
			shortName: string;
	  };

/** 즐겨찾기 ID. 역은 `station:<key>`, 정류장과 노선은 출처 접두사가 붙은 ref를 그대로 쓴다. */
export function favoriteId(
	target:
		| { key: string; kind: "station" }
		| { kind: "stop"; stop: string }
		| { kind: "route"; line: string }
): string {
	if (target.kind === "station") {
		return `station:${target.key}`;
	}
	return target.kind === "stop"
		? `stop:${target.stop}`
		: `route:${target.line}`;
}

/** 서울 출처만 받는다. 경기·인천(`gbis:`·`tago:`)과 접두사 없는 옛 값은 버린다(스펙 5.10 원칙 3). */
const SEOUL_REF = /^seoul-(subway|bus):/;
const ref = z.string().regex(SEOUL_REF);

const base = { addedAt: z.number(), id: z.string() };

const favoriteSchema = z.discriminatedUnion("kind", [
	z.object({
		...base,
		kind: z.literal("station"),
		members: z.array(z.object({ line: ref, stop: ref })).min(1),
		name: z.string(),
	}),
	z.object({
		...base,
		arsId: z.string().nullable(),
		kind: z.literal("stop"),
		name: z.string(),
		stop: ref,
		towards: z.string().nullable(),
	}),
	z.object({
		...base,
		kind: z.literal("route"),
		line: ref,
		name: z.string(),
		routeType: z.string(),
		shortName: z.string(),
	}),
]);

/** 저장값을 읽는다. 전체가 깨졌으면 빈 목록이고, 모양이 틀리거나 범위 밖인 항목만 버린다. */
export function parseFavorites(raw: string | null): Favorite[] {
	if (raw === null) {
		return [];
	}
	try {
		const stored: unknown = JSON.parse(raw);
		if (
			typeof stored !== "object" ||
			stored === null ||
			(stored as { version?: unknown }).version !== 1
		) {
			return [];
		}
		const list = (stored as { favorites?: unknown }).favorites;
		if (!Array.isArray(list)) {
			return [];
		}
		const favorites: Favorite[] = [];
		for (const entry of list) {
			const parsed = favoriteSchema.safeParse(entry);
			if (parsed.success) {
				favorites.push(parsed.data);
			}
		}
		return favorites;
	} catch {
		return [];
	}
}

export function serializeFavorites(list: readonly Favorite[]): string {
	return JSON.stringify({ favorites: list, version: 1 });
}

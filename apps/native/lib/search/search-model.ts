import type {
	SearchIndex,
	SearchRoute,
	SearchStation,
	SearchStop,
} from "./search-client";

export type SearchScope = "all" | "station" | "stop" | "route";
export type SearchTarget =
	| { kind: "station"; key: string; name: string }
	| { kind: "stop"; name: string; stop: string }
	| { kind: "route"; line: string; name: string; shortName: string };

export interface SearchSections {
	routes: SearchRoute[];
	stations: SearchStation[];
	stops: SearchStop[];
}

/** '전체'에서 구역마다 보이는 개수. */
export const ALL_SECTION_LIMIT = 3;
/** 범위 칩을 고른 구역에서 보이는 개수. */
export const SCOPED_LIMIT = 50;

/** 역 이름과 질의 끝의 "역"을 뗄 때 쓰는 글자(한글 리터럴 금지라 이스케이프로 쓴다). */
const STATION_SUFFIX = String.fromCodePoint(0xc5_ed);

/** NFC로 맞추고 소문자로 바꾸고 공백을 모두 지운다. */
export function normalizeQuery(raw: string): string {
	return raw.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

/** 끝의 "역"을 뗀다. 떼면 빈 글자가 되는 "역" 하나는 그대로 둔다. */
function stripStationSuffix(value: string): string {
	return value.length > 1 && value.endsWith(STATION_SUFFIX)
		? value.slice(0, -1)
		: value;
}

/** 같음 0, 앞부분 1, 포함 2, 맞지 않으면 null. */
function rankOf(target: string, query: string): number | null {
	if (target === query) {
		return 0;
	}
	if (target.startsWith(query)) {
		return 1;
	}
	return target.includes(query) ? 2 : null;
}

function bestRank(ranks: readonly (number | null)[]): number | null {
	let best: number | null = null;
	for (const rank of ranks) {
		if (rank !== null && (best === null || rank < best)) {
			best = rank;
		}
	}
	return best;
}

/** 순위, 짧은 이름, 이름 순으로 정렬해 limit개까지 돌려준다. */
function rankItems<T>(
	items: readonly T[],
	limit: number,
	rankItem: (item: T) => { name: string; rank: number | null }
): T[] {
	const scored: { item: T; name: string; rank: number }[] = [];
	for (const item of items) {
		const { name, rank } = rankItem(item);
		if (rank !== null) {
			scored.push({ item, name, rank });
		}
	}
	scored.sort((a, b) => {
		if (a.rank !== b.rank) {
			return a.rank - b.rank;
		}
		if (a.name.length !== b.name.length) {
			return a.name.length - b.name.length;
		}
		if (a.name === b.name) {
			return 0;
		}
		return a.name < b.name ? -1 : 1;
	});
	return scored.slice(0, limit).map((entry) => entry.item);
}

/**
 * 기기에 받아 둔 색인에서 찾는다(설계 결정 4). 빈 질의는 빈 결과다.
 * 역은 질의와 이름 끝의 "역"을 떼고, 버스 노선은 번호, 정류장은 이름과 arsId 앞부분을 본다.
 */
export function searchIndex(
	index: SearchIndex,
	query: string,
	scope: SearchScope
): SearchSections {
	const normalized = normalizeQuery(query);
	if (normalized === "") {
		return { routes: [], stations: [], stops: [] };
	}
	const stationQuery = stripStationSuffix(normalized);
	const limit = scope === "all" ? ALL_SECTION_LIMIT : SCOPED_LIMIT;
	const wants = (section: Exclude<SearchScope, "all">) =>
		scope === "all" || scope === section;

	return {
		routes: wants("route")
			? rankItems(index.routes, limit, (route) => {
					const name = normalizeQuery(route.shortName);
					return { name, rank: rankOf(name, normalized) };
				})
			: [],
		stations: wants("station")
			? rankItems(index.stations, limit, (station) => {
					const name = stripStationSuffix(normalizeQuery(station.name));
					return { name, rank: rankOf(name, stationQuery) };
				})
			: [],
		stops: wants("stop")
			? rankItems(index.stops, limit, (stop) => {
					const name = normalizeQuery(stop.name);
					const arsId = stop.arsId === null ? null : normalizeQuery(stop.arsId);
					return {
						name,
						rank: bestRank([
							rankOf(name, normalized),
							// 정류장 번호는 앞부분만 본다.
							arsId?.startsWith(normalized)
								? Number(arsId !== normalized)
								: null,
						]),
					};
				})
			: [],
	};
}

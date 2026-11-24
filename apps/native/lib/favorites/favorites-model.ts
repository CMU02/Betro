import { STATION_VIEW_MAX, type StationView } from "../detail/detail-client";
import { targetHref } from "../search/search-view-model";
import type { Favorite } from "./favorites";

export type FavoritesFilter = "all" | "station" | "stop" | "route";

export function filterFavorites(
	list: readonly Favorite[],
	filter: FavoritesFilter
): Favorite[] {
	return filter === "all"
		? list.slice()
		: list.filter((favorite) => favorite.kind === filter);
}

/** 화면에 보이는 역 즐겨찾기만 한 번에 묻는다. STATION_VIEW_MAX를 넘으면 나눈다. */
export function stationViewBatches(
	list: readonly Favorite[]
): { line: string; stop: string }[][] {
	const seen = new Set<string>();
	const members: { line: string; stop: string }[] = [];
	for (const favorite of list) {
		if (favorite.kind !== "station") {
			continue;
		}
		for (const member of favorite.members) {
			const key = `${member.line}|${member.stop}`;
			if (!seen.has(key)) {
				seen.add(key);
				members.push(member);
			}
		}
	}
	const batches: { line: string; stop: string }[][] = [];
	for (let i = 0; i < members.length; i += STATION_VIEW_MAX) {
		batches.push(members.slice(i, i + STATION_VIEW_MAX));
	}
	return batches;
}

/** 나눠 받은 도착판을 하나로 합친다. 받은 것이 없으면 null이다. */
export function mergeStationViews(
	views: readonly StationView[]
): StationView | null {
	const [first] = views;
	if (first === undefined) {
		return null;
	}
	return {
		generatedAt: Math.max(...views.map((view) => view.generatedAt)),
		stations: views.flatMap((view) => view.stations),
		timezone: first.timezone,
	};
}

/** 합친 도착판에서 이 역 묶음의 구성 역만 남긴다. 같은 노선의 다른 역과 섞이지 않게 노선과 역을 함께 본다. */
export function viewForMembers(
	view: StationView,
	members: readonly { line: string; stop: string }[]
): StationView {
	return {
		generatedAt: view.generatedAt,
		stations: view.stations.filter((entry) =>
			members.some(
				(member) => member.line === entry.line && member.stop === entry.stop
			)
		),
		timezone: view.timezone,
	};
}

const STATION_ID_PREFIX = "station:";

/** 카드를 눌렀을 때 갈 상세 경로. 검색 결과와 같은 경로를 쓴다. */
export function favoriteHref(favorite: Favorite): string {
	switch (favorite.kind) {
		case "station":
			return targetHref({
				key: favorite.id.slice(STATION_ID_PREFIX.length),
				kind: "station",
				name: favorite.name,
			});
		case "stop":
			return targetHref({
				kind: "stop",
				name: favorite.name,
				stop: favorite.stop,
			});
		default:
			return targetHref({
				kind: "route",
				line: favorite.line,
				name: favorite.name,
				shortName: favorite.shortName,
			});
	}
}

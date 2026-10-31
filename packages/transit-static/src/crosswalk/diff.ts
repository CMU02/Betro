import type { RealtimeStationRow } from "../sources/station-xlsx";

export interface StationListDiff {
	added: RealtimeStationRow[];
	removed: RealtimeStationRow[];
	renamed: { statnId: string; from: string; to: string }[];
}

/** 두 판의 실시간 역 목록을 statnId 기준으로 비교한다. */
export function diffStationLists(
	prev: RealtimeStationRow[],
	next: RealtimeStationRow[]
): StationListDiff {
	const prevById = new Map(prev.map((station) => [station.statnId, station]));
	const nextById = new Map(next.map((station) => [station.statnId, station]));
	const added = next.filter((station) => !prevById.has(station.statnId));
	const removed = prev.filter((station) => !nextById.has(station.statnId));
	const renamed: StationListDiff["renamed"] = [];
	for (const station of next) {
		const before = prevById.get(station.statnId);
		if (before && before.nameRaw !== station.nameRaw) {
			renamed.push({
				from: before.nameRaw,
				statnId: station.statnId,
				to: station.nameRaw,
			});
		}
	}
	return { added, removed, renamed };
}

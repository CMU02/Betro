import type { LineKey } from "../lines";
import type { StationMasterRow } from "../sources/seoul-open-api";
import type { RealtimeStationRow } from "../sources/station-xlsx";
import { normalizeStationName } from "./normalize-name";
import {
	mapSourceLineName,
	type SourceLineNameTable,
} from "./source-line-names";

export interface StationAlias {
	masterName: string;
	statnId: string;
}

export interface MatchInput {
	aliases: StationAlias[];
	/** 범위 밖 노선 문자열. 매핑하지 않지만 unmappedRoutes에도 세지 않는다. */
	ignoredRoutes?: readonly string[];
	lineNames: SourceLineNameTable;
	master: StationMasterRow[];
	stations: RealtimeStationRow[];
}

export type MatchMethod = "auto-same-line" | "auto-shared" | "manual-alias";

export interface CrosswalkRow {
	bldnId: string;
	coordSource: "station-master";
	frCode?: string;
	lat: number;
	lineKey: LineKey;
	lng: number;
	matchMethod: MatchMethod;
	nameAliases: string[];
	nameCanonical: string;
	qualityFlags: string[];
	stationCd?: string;
	statnId: string;
	subwayId: string;
}

export interface MatchResult {
	rows: CrosswalkRow[];
	unmappedRoutes: { route: string; count: number }[];
	unmatched: RealtimeStationRow[];
}

type NameIndex = Map<string, StationMasterRow[]>;

interface MasterIndex {
	byLine: Map<LineKey, NameIndex>;
	byName: NameIndex;
	unmappedRoutes: Map<string, number>;
}

interface MasterHit {
	flags: string[];
	record: StationMasterRow;
	tier: "same-line" | "shared";
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list) {
		list.push(value);
	} else {
		map.set(key, [value]);
	}
}

function indexMaster(
	master: StationMasterRow[],
	lineNames: SourceLineNameTable,
	ignoredRoutes: ReadonlySet<string>
): MasterIndex {
	const byLine = new Map<LineKey, NameIndex>();
	const byName: NameIndex = new Map();
	const unmappedRoutes = new Map<string, number>();
	for (const record of master) {
		const name = normalizeStationName(record.bldnNm);
		pushTo(byName, name, record);
		const lineKey = mapSourceLineName(
			"stationMasterRoute",
			record.route,
			lineNames
		);
		if (!lineKey) {
			if (ignoredRoutes.has(record.route)) {
				continue;
			}
			unmappedRoutes.set(
				record.route,
				(unmappedRoutes.get(record.route) ?? 0) + 1
			);
			continue;
		}
		let names = byLine.get(lineKey);
		if (!names) {
			names = new Map();
			byLine.set(lineKey, names);
		}
		pushTo(names, name, record);
	}
	return { byLine, byName, unmappedRoutes };
}

/** (1) 같은 노선의 같은 역명, (2) 노선 무관 같은 역명 순으로 찾는다. */
function findMaster(
	index: MasterIndex,
	lineKey: LineKey,
	normalizedName: string
): MasterHit | undefined {
	const sameLine = index.byLine.get(lineKey)?.get(normalizedName) ?? [];
	const [firstSameLine] = sameLine;
	if (firstSameLine) {
		return {
			flags: sameLine.length > 1 ? ["duplicate-master"] : [],
			record: firstSameLine,
			tier: "same-line",
		};
	}
	const shared = index.byName.get(normalizedName) ?? [];
	const [firstShared] = shared;
	if (firstShared) {
		return {
			flags: shared.length > 1 ? ["shared-multiple"] : [],
			record: firstShared,
			tier: "shared",
		};
	}
	return undefined;
}

function aliasesByStatnId(aliases: StationAlias[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const alias of aliases) {
		pushTo(map, alias.statnId, alias.masterName);
	}
	return map;
}

function toRow(
	station: RealtimeStationRow,
	hit: MasterHit,
	matchMethod: MatchMethod,
	aliasName?: string
): CrosswalkRow {
	const names = [station.nameRaw, hit.record.bldnNm];
	if (aliasName !== undefined) {
		names.push(aliasName);
	}
	return {
		bldnId: hit.record.bldnId,
		coordSource: "station-master",
		lat: hit.record.lat,
		lineKey: station.lineKey,
		lng: hit.record.lng,
		matchMethod,
		nameAliases: [...new Set(names)],
		nameCanonical: normalizeStationName(station.nameRaw),
		qualityFlags: hit.flags,
		statnId: station.statnId,
		subwayId: station.subwayId,
	};
}

function matchOne(
	station: RealtimeStationRow,
	index: MasterIndex,
	aliasNames: string[]
): CrosswalkRow | undefined {
	const direct = findMaster(
		index,
		station.lineKey,
		normalizeStationName(station.nameRaw)
	);
	if (direct) {
		const method =
			direct.tier === "same-line" ? "auto-same-line" : "auto-shared";
		return toRow(station, direct, method);
	}
	for (const aliasName of aliasNames) {
		const viaAlias = findMaster(
			index,
			station.lineKey,
			normalizeStationName(aliasName)
		);
		if (viaAlias) {
			return toRow(station, viaAlias, "manual-alias", aliasName);
		}
	}
	return undefined;
}

/**
 * 실시간 역 목록을 역사마스터에 3단계로 맞춘다:
 * 같은 노선 역명 → 공용역(노선 무관) 역명 → 수동 별칭 표.
 * 맞추지 못한 역은 던지지 않고 unmatched로 돌려준다.
 */
export function matchStations(input: MatchInput): MatchResult {
	const index = indexMaster(
		input.master,
		input.lineNames,
		new Set(input.ignoredRoutes)
	);
	const aliases = aliasesByStatnId(input.aliases);
	const rows: CrosswalkRow[] = [];
	const unmatched: RealtimeStationRow[] = [];
	for (const station of input.stations) {
		const row = matchOne(station, index, aliases.get(station.statnId) ?? []);
		if (row) {
			rows.push(row);
		} else {
			unmatched.push(station);
		}
	}
	const unmappedRoutes = [...index.unmappedRoutes].map(([route, count]) => ({
		count,
		route,
	}));
	return { rows, unmappedRoutes, unmatched };
}

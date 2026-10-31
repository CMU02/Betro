import type { TimetableSourceKind } from "@Betro/db/schema/transit";
import type { CrosswalkRow } from "../crosswalk/match";
import { normalizeStationName } from "../crosswalk/normalize-name";
import type { LineKey } from "../lines";

/**
 * 코드나 이름만으로 해석되지 않는 시간표 역을 statn_id에 직접 잇는 수동 별칭.
 * statnId가 null이면 대응표(실시간 API 역 목록) 범위 밖의 역이라는 뜻이고, 그 정차는 빼고 excluded로 센다.
 */
export interface StationAlias {
	lineKey: LineKey;
	source: TimetableSourceKind | "*";
	/** 출처 원문 역사코드 또는 역명 */
	sourceStation: string;
	statnId: string | null;
}

export interface ResolveArgs {
	code?: string;
	lineKey: LineKey;
	name?: string;
	source: TimetableSourceKind;
}

export type ResolveResult =
	| { method: "code" | "name" | "alias"; statnId: string }
	| { method: "excluded" }
	| { candidates: string[]; error: "unknown" | "ambiguous" };

export interface UnresolvedStation {
	code?: string;
	count: number;
	lineKey: LineKey;
	name?: string;
	source: TimetableSourceKind;
}

export interface StationResolver {
	/** statnId가 null인 별칭으로 뺀 역과 그 빈도 */
	excluded: () => UnresolvedStation[];
	resolve: (args: ResolveArgs) => ResolveResult;
	unresolved: () => UnresolvedStation[];
}

function countStation(
	counts: Map<string, UnresolvedStation>,
	args: ResolveArgs
) {
	const key = [args.source, args.lineKey, args.code, args.name].join("|");
	const entry = counts.get(key);
	if (entry) {
		entry.count += 1;
		return;
	}
	counts.set(key, {
		code: args.code,
		count: 1,
		lineKey: args.lineKey,
		name: args.name,
		source: args.source,
	});
}

function pushUnique(map: Map<string, string[]>, key: string, statnId: string) {
	const list = map.get(key);
	if (!list) {
		map.set(key, [statnId]);
	} else if (!list.includes(statnId)) {
		list.push(statnId);
	}
}

/** 노선 안에서만 찾는 코드·이름 색인과 별칭표로 시간표 역을 statn_id에 잇는다. */
export function createStationResolver(
	crosswalk: CrosswalkRow[],
	aliases: StationAlias[]
): StationResolver {
	const byCode = new Map<string, string[]>();
	const byName = new Map<string, string[]>();
	for (const row of crosswalk) {
		if (row.stationCd) {
			pushUnique(byCode, `${row.lineKey}|${row.stationCd}`, row.statnId);
		}
		for (const name of [row.nameCanonical, ...row.nameAliases]) {
			pushUnique(
				byName,
				`${row.lineKey}|${normalizeStationName(name)}`,
				row.statnId
			);
		}
	}
	const aliasIndex = new Map<string, string | null>();
	for (const alias of aliases) {
		aliasIndex.set(
			`${alias.source}|${alias.lineKey}|${alias.sourceStation}`,
			alias.statnId
		);
	}
	const failures = new Map<string, UnresolvedStation>();
	const exclusions = new Map<string, UnresolvedStation>();

	/** 별칭으로 해석한 결과. statnId가 null인 별칭이면 excluded, 별칭이 없으면 undefined. */
	const lookupAlias = (args: ResolveArgs): ResolveResult | undefined => {
		for (const text of [args.code, args.name]) {
			if (text === undefined) {
				continue;
			}
			for (const source of [args.source, "*"]) {
				const key = `${source}|${args.lineKey}|${text}`;
				if (!aliasIndex.has(key)) {
					continue;
				}
				const statnId = aliasIndex.get(key);
				return statnId ? { method: "alias", statnId } : { method: "excluded" };
			}
		}
		return undefined;
	};

	const resolveUncounted = (args: ResolveArgs): ResolveResult => {
		const failure: ResolveResult = { candidates: [], error: "unknown" };
		if (args.code !== undefined) {
			const hits = byCode.get(`${args.lineKey}|${args.code}`);
			if (hits?.length === 1) {
				return { method: "code", statnId: hits[0] as string };
			}
			if (hits && hits.length > 1) {
				return { candidates: hits, error: "ambiguous" };
			}
		}
		if (args.name !== undefined) {
			const hits = byName.get(
				`${args.lineKey}|${normalizeStationName(args.name)}`
			);
			if (hits?.length === 1) {
				return { method: "name", statnId: hits[0] as string };
			}
			if (hits && hits.length > 1) {
				failure.error = "ambiguous";
				failure.candidates = [...hits].sort();
			}
		}
		return lookupAlias(args) ?? failure;
	};

	return {
		excluded() {
			return [...exclusions.values()];
		},
		resolve(args) {
			const result = resolveUncounted(args);
			if ("error" in result) {
				countStation(failures, args);
			} else if (result.method === "excluded") {
				countStation(exclusions, args);
			}
			return result;
		},
		unresolved() {
			return [...failures.values()];
		},
	};
}

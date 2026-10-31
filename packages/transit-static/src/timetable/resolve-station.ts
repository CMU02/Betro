import type { TimetableSourceKind } from "@Betro/db/schema/transit";
import type { CrosswalkRow } from "../crosswalk/match";
import { normalizeStationName } from "../crosswalk/normalize-name";
import type { LineKey } from "../lines";

/** 코드나 이름만으로 해석되지 않는 시간표 역을 statn_id에 직접 잇는 수동 별칭. */
export interface StationAlias {
	lineKey: LineKey;
	source: TimetableSourceKind | "*";
	/** 출처 원문 역사코드 또는 역명 */
	sourceStation: string;
	statnId: string;
}

export interface ResolveArgs {
	code?: string;
	lineKey: LineKey;
	name?: string;
	source: TimetableSourceKind;
}

export type ResolveResult =
	| { method: "code" | "name" | "alias"; statnId: string }
	| { candidates: string[]; error: "unknown" | "ambiguous" };

export interface UnresolvedStation {
	code?: string;
	count: number;
	lineKey: LineKey;
	name?: string;
	source: TimetableSourceKind;
}

export interface StationResolver {
	resolve: (args: ResolveArgs) => ResolveResult;
	unresolved: () => UnresolvedStation[];
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
	const aliasIndex = new Map<string, string>();
	for (const alias of aliases) {
		aliasIndex.set(
			`${alias.source}|${alias.lineKey}|${alias.sourceStation}`,
			alias.statnId
		);
	}
	const failures = new Map<string, UnresolvedStation>();

	const lookupAlias = (args: ResolveArgs): string | undefined => {
		for (const text of [args.code, args.name]) {
			if (text === undefined) {
				continue;
			}
			const hit =
				aliasIndex.get(`${args.source}|${args.lineKey}|${text}`) ??
				aliasIndex.get(`*|${args.lineKey}|${text}`);
			if (hit) {
				return hit;
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
		const aliased = lookupAlias(args);
		if (aliased) {
			return { method: "alias", statnId: aliased };
		}
		return failure;
	};

	return {
		resolve(args) {
			const result = resolveUncounted(args);
			if ("error" in result) {
				const key = [args.source, args.lineKey, args.code, args.name].join("|");
				const entry = failures.get(key);
				if (entry) {
					entry.count += 1;
				} else {
					failures.set(key, {
						code: args.code,
						count: 1,
						lineKey: args.lineKey,
						name: args.name,
						source: args.source,
					});
				}
			}
			return result;
		},
		unresolved() {
			return [...failures.values()];
		},
	};
}

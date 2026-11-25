import type { MessageKey } from "@/lib/i18n/translate";
import type {
	SearchIndex,
	SearchRoute,
	SearchStation,
	SearchStop,
} from "./search-client";

import {
	normalizeQuery,
	type SearchScope,
	type SearchSections,
	type SearchTarget,
	searchIndex,
} from "./search-model";

export type SearchViewState =
	| { kind: "loading" }
	| { kind: "failed" }
	| { kind: "recents"; recents: SearchTarget[] }
	| { kind: "empty" }
	| { kind: "results"; sections: SearchSections };

/**
 * 검색 화면이 보일 상태 하나를 고른다. 색인이 있으면(받아 둔 저장본 포함) 실패 표시와 상관없이 찾는다.
 * 색인이 없을 때만 불러오는 중과 실패를 가른다.
 */
export function searchViewState(input: {
	index: SearchIndex | null;
	failed: boolean;
	query: string;
	recents: SearchTarget[];
	scope: SearchScope;
}): SearchViewState {
	if (input.index === null) {
		return input.failed ? { kind: "failed" } : { kind: "loading" };
	}
	if (normalizeQuery(input.query) === "") {
		return { kind: "recents", recents: input.recents };
	}
	const sections = searchIndex(input.index, input.query, input.scope);
	if (
		sections.stations.length === 0 &&
		sections.stops.length === 0 &&
		sections.routes.length === 0
	) {
		return { kind: "empty" };
	}
	return { kind: "results", sections };
}

/** 결과를 눌렀을 때 갈 경로. ref에 `:`가 있어 인코딩한다. */
export function targetHref(target: SearchTarget): string {
	switch (target.kind) {
		case "station":
			return `/station/${encodeURIComponent(target.key)}`;
		case "stop":
			return `/stop/${encodeURIComponent(target.stop)}`;
		default:
			return `/bus/${encodeURIComponent(target.line)}`;
	}
}

export function stationTarget(station: SearchStation): SearchTarget {
	return { key: station.key, kind: "station", name: station.name };
}

export function stopTarget(stop: SearchStop): SearchTarget {
	return { kind: "stop", name: stop.name, stop: stop.stop };
}

export function routeTarget(route: SearchRoute): SearchTarget {
	return {
		kind: "route",
		line: route.line,
		name: route.name,
		shortName: route.shortName,
	};
}

/** 역을 이루는 노선 ref를 중복 없이, 나온 순서대로 돌려준다. */
export function stationLineKeys(station: SearchStation): string[] {
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const member of station.members) {
		if (!seen.has(member.line)) {
			seen.add(member.line);
			lines.push(member.line);
		}
	}
	return lines;
}

/** 노선 키(`seoul-subway:` 뒤)에서 노선 이름 문구 키로. */
const LINE_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
	airport: "search.lineName.airport",
	"gtx-a": "search.lineName.gtxA",
	gyeongchun: "search.lineName.gyeongchun",
	gyeonggang: "search.lineName.gyeonggang",
	"gyeongui-jungang": "search.lineName.gyeonguiJungang",
	line1: "search.lineName.line1",
	line2: "search.lineName.line2",
	line3: "search.lineName.line3",
	line4: "search.lineName.line4",
	line5: "search.lineName.line5",
	line6: "search.lineName.line6",
	line7: "search.lineName.line7",
	line8: "search.lineName.line8",
	line9: "search.lineName.line9",
	seohae: "search.lineName.seohae",
	shinbundang: "search.lineName.shinbundang",
	sillim: "search.lineName.sillim",
	"suin-bundang": "search.lineName.suinBundang",
	"ui-sinseol": "search.lineName.uiSinseol",
};

/** 노선 ref의 이름 문구 키. 모르는 노선은 null이다(배지는 중립색에 노선 키를 그대로 쓴다). */
export function lineNameKey(lineRef: string): MessageKey | null {
	const id = lineRef.slice(lineRef.indexOf(":") + 1);
	return LINE_NAME_KEYS[id] ?? null;
}

/** 정류장 행 부제. `arsId`나 `towards`가 없으면 그 부분을 뺀다. */
export function stopSubtitleKey(stop: SearchStop): MessageKey | null {
	if (stop.arsId !== null && stop.towards !== null) {
		return "search.stopSubtitle";
	}
	if (stop.arsId !== null) {
		return "search.stopSubtitleArsId";
	}
	return stop.towards === null ? null : "search.stopSubtitleTowards";
}

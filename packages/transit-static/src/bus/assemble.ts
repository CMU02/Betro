import type { BusRouteListEntry } from "../sources/bus-route-xlsx";
import {
	type BusRouteStationRow,
	parseBusEnvelope,
	parseRoutePath,
	parseRouteStations,
} from "../sources/seoul-bus-api";
import {
	type BusSegment,
	buildSegments,
	type ProjectedStop,
	projectStopsForward,
} from "./project-stops";
import { REPORT_SHAPE_ATTRIBUTION, renderBusRouteReport } from "./report";
import { isInScopeRouteType } from "./scope";

/**
 * 버스 노선 모양에 붙이는 출처 표기. 모양은 getRoutePath(공공데이터)에서만 가져온다. OSM이 아니므로 ODbL 표기를 붙이지 않는다.
 * 값은 report.ts에 둔다. report.ts가 assemble.ts에서 타입만 가져오게 해 import 순환을 끊는다.
 */
export const BUS_SHAPE_ATTRIBUTION = REPORT_SHAPE_ATTRIBUTION;

/** 조립 결과가 바뀌는 코드 변경마다 올린다. manifest에 들어간다. */
export const BUS_ROUTE_LOGIC_VERSION = 1;

/** 범위 안 노선 중 적재 가능한 노선이 이 비율 이상이어야 배치를 적재한다. */
export const MIN_VALID_ROUTE_RATIO = 0.98;

/** 이보다 짧은 모양(미터)은 정류소를 투영할 수 없다고 본다. */
const MIN_SHAPE_LENGTH_M = 100;
const MIN_SHAPE_POINTS = 2;
/** 오류 detail에 보여 줄 파서 오류·seq 수. */
const DETAIL_SAMPLE = 5;
/**
 * 원본을 읽은 상태로 응답 상태 코드를 알 수 없으므로, 저장된 원본은 HTTP 200으로 받은 것으로 본다.
 * 수집 잡은 ok 본문과 노선 없음 표시 본문(headerCd 4, fetch-bus-routes ROUTE_NOT_FOUND_BODY)만 저장한다.
 */
const STORED_STATUS = 200;
/** parseBusEnvelope가 msgHeader에서 만든 detail("headerCd N: headerMsg")만 본문 조각이 없다. */
const HEADER_DETAIL = /^headerCd /;
const WHITESPACE_RUN = /\s+/g;

export interface BusRouteRaw {
	entry: BusRouteListEntry;
	pathBody?: string;
	stationsBody?: string;
}

export interface BusIssue {
	code: string;
	detail: string;
	level: "error" | "warning";
}

export interface AssembledBusRoute {
	coords: [number, number][];
	issues: BusIssue[];
	lengthM: number;
	qualityFlags: string[];
	routeId: string;
	routeName: string;
	routeType: string;
	segments: BusSegment[];
	stops: (BusRouteStationRow & ProjectedStop)[];
}

export interface BusAssembleResult {
	excluded: { routeId: string; routeName: string; issues: BusIssue[] }[];
	markdown: string;
	/**
	 * 정류소 원본이 없거나, 범위 안인데 모양 원본이 없는 노선 ID(수집이 덜 끝남).
	 * API가 노선 없음으로 답한 노선은 표시 본문이 저장되므로 여기가 아니라 excluded(route-not-found)에 들어간다.
	 */
	missingRaw: string[];
	ok: boolean;
	outOfScope: number;
	routes: AssembledBusRoute[];
	/** 정류소 원본을 읽은 모든 노선(범위 밖 포함)의 routeType별 개수. */
	routeTypeCounts: Record<string, number>;
}

export interface AssembleBusRouteResult {
	issues: BusIssue[];
	outOfScope: boolean;
	route?: AssembledBusRoute;
	/** 정류소 원본에서 읽은 첫 행(API 순서)의 routeType. fetch-bus-routes의 범위 판정과 같다. */
	routeType?: string;
}

const error = (code: string, detail: string): BusIssue => ({
	code,
	detail,
	level: "error",
});
const warning = (code: string, detail: string): BusIssue => ({
	code,
	detail,
	level: "warning",
});

const sample = (values: readonly (string | number)[]): string =>
	values.length > DETAIL_SAMPLE
		? `${values.slice(0, DETAIL_SAMPLE).join(", ")} 외 ${values.length - DETAIL_SAMPLE}개`
		: values.join(", ");

/**
 * 저장된 원본 본문을 봉투로 읽는다. 노선 없음(headerCd 4)이면 route-not-found, 그 밖에 ok가 아니면 bad-envelope 오류.
 * route-not-found는 API가 끝까지 답한 결과이므로 missingRaw가 아니라 excluded로 가서 MIN_VALID_ROUTE_RATIO에 들어간다.
 * 조립 단계에는 키가 없어 가릴 수 없으므로, 본문 조각이 든 detail은 보고서에 넣지 않고 headerCd·headerMsg만 남긴다.
 */
function readItems(
	body: string,
	label: string
): { items: Record<string, unknown>[] } | { issue: BusIssue } {
	const envelope = parseBusEnvelope(STORED_STATUS, body);
	if (envelope.kind === "route-not-found") {
		return { issue: error("route-not-found", `${label} headerCd 4`) };
	}
	if (envelope.kind !== "ok") {
		const header =
			"detail" in envelope && HEADER_DETAIL.test(envelope.detail)
				? `: ${envelope.detail.replace(WHITESPACE_RUN, " ")}`
				: "";
		return {
			issue: error("bad-envelope", `${label} ${envelope.kind}${header}`),
		};
	}
	return { items: envelope.items };
}

/** seq가 1..n이 아니면(빠짐·중복) 문제 seq 목록을 돌려준다. 입력은 seq 오름차순. */
function seqGaps(rows: readonly BusRouteStationRow[]): number[] {
	const problems: number[] = [];
	for (const [i, row] of rows.entries()) {
		if (row.seq !== i + 1) {
			problems.push(row.seq);
		}
	}
	return problems;
}

interface StationsRead {
	/** 못 읽은 행의 파서 오류. 범위 판정 뒤에 범위 안 노선만 이것으로 뺀다. */
	errors: string[];
	/** 읽은 행의 첫 행(API 순서) routeType. fetch-bus-routes readRouteType과 같은 규칙. */
	routeType: string;
	/** seq 오름차순. */
	rows: BusRouteStationRow[];
}

/**
 * 정류소 원본을 읽는다. 봉투 오류나 읽은 행이 하나도 없을 때만 범위 판정 전에 노선을 뺀다.
 * 범위는 읽은 행으로 정한다. 행 몇 개가 깨져도 수집 단계(fetch-bus-routes)는 범위 밖으로 보고 모양을 받지 않으므로 같게 판정한다.
 */
function readStations(
	stationsBody: string
): StationsRead | { issue: BusIssue } {
	const read = readItems(stationsBody, "getStaionByRoute");
	if ("issue" in read) {
		return read;
	}
	const { rows, errors } = parseRouteStations(read.items);
	const [first] = rows;
	if (!first) {
		return errors.length > 0
			? { issue: error("bad-station-row", sample(errors)) }
			: { issue: error("no-stops", "getStaionByRoute itemList is empty") };
	}
	return {
		errors,
		routeType: first.routeType,
		rows: rows.toSorted((a, b) => a.seq - b.seq),
	};
}

function routeTypeWarnings(
	rows: readonly BusRouteStationRow[],
	routeType: string
): BusIssue[] {
	const types = [...new Set(rows.map((row) => row.routeType))];
	return types.length > 1
		? [
				warning(
					"mixed-route-type",
					`routeType ${types.join(", ")}; using ${routeType}`
				),
			]
		: [];
}

function projectionWarnings(
	stops: readonly (BusRouteStationRow & ProjectedStop)[],
	segments: readonly BusSegment[]
): BusIssue[] {
	const issues: BusIssue[] = [];
	for (const stop of stops) {
		for (const flag of stop.flags) {
			issues.push(
				warning(
					flag,
					`seq ${stop.seq} ${stop.name}: ${stop.distanceM.toFixed(0)}m, offset ${stop.offsetM.toFixed(1)}m`
				)
			);
		}
	}
	for (const segment of segments) {
		for (const flag of segment.flags) {
			issues.push(
				warning(
					flag,
					`seq ${segment.fromSeq}→${segment.toSeq}: shape ${(segment.endM - segment.startM).toFixed(0)}m, api ${segment.apiSectDistM}m`
				)
			);
		}
	}
	return issues;
}

/**
 * 노선 하나의 원본(정류소·모양 본문)을 읽어 정류소를 모양 위에 투영하고 구간을 만든다.
 * error가 하나라도 있으면 route는 없다(적재에서 뺀다). 범위 밖 노선은 모양 원본 없이 outOfScope로 끝난다.
 */
export function assembleBusRoute(raw: BusRouteRaw): AssembleBusRouteResult {
	const { entry } = raw;
	if (raw.stationsBody === undefined) {
		return {
			issues: [error("missing-stations", "getStaionByRoute raw not found")],
			outOfScope: false,
		};
	}
	const stations = readStations(raw.stationsBody);
	if ("issue" in stations) {
		return { issues: [stations.issue], outOfScope: false };
	}
	const { errors, routeType, rows } = stations;
	const issues = routeTypeWarnings(rows, routeType);
	if (!isInScopeRouteType(routeType)) {
		return { issues, outOfScope: true, routeType };
	}
	// 범위 안 노선은 행 하나라도 못 읽으면 seq로 잇는 구간이 틀어지므로 뺀다.
	if (errors.length > 0) {
		issues.push(error("bad-station-row", sample(errors)));
		return { issues, outOfScope: false, routeType };
	}
	const gaps = seqGaps(rows);
	if (gaps.length > 0) {
		issues.push(
			error(
				"seq-not-contiguous",
				`expected 1..${rows.length}, unexpected seq ${sample(gaps)}`
			)
		);
	}
	if (entry.stopCount !== rows.length) {
		issues.push(
			warning(
				"xlsx-stop-count-mismatch",
				`xlsx ${entry.stopCount} stops, api ${rows.length}`
			)
		);
	}
	if (raw.pathBody === undefined) {
		issues.push(error("missing-path", "getRoutePath raw not found"));
		return { issues, outOfScope: false, routeType };
	}
	const path = readItems(raw.pathBody, "getRoutePath");
	if ("issue" in path) {
		issues.push(path.issue);
		return { issues, outOfScope: false, routeType };
	}
	const { coords, errors: pathErrors } = parseRoutePath(path.items);
	// 모양 점 몇 개가 빠져도 선은 이어지므로 경고로 남긴다.
	if (pathErrors.length > 0) {
		issues.push(warning("bad-path-point", sample(pathErrors)));
	}
	if (coords.length < MIN_SHAPE_POINTS) {
		issues.push(error("shape-too-short", `${coords.length} points`));
	}
	if (issues.some((issue) => issue.level === "error")) {
		return { issues, outOfScope: false, routeType };
	}
	const projection = projectStopsForward(coords, rows);
	if (projection.lengthM < MIN_SHAPE_LENGTH_M) {
		issues.push(
			error("shape-too-short", `${projection.lengthM.toFixed(1)}m long`)
		);
		return { issues, outOfScope: false, routeType };
	}
	const stops = rows.map((row, i) => {
		const projected = projection.stops[i];
		if (projected?.seq !== row.seq) {
			throw new Error(
				`assembleBusRoute: projection out of order at seq ${row.seq}`
			);
		}
		return { ...row, ...projected };
	});
	const segments = buildSegments(rows, projection.stops);
	issues.push(...projectionWarnings(stops, segments));
	return {
		issues,
		outOfScope: false,
		route: {
			coords,
			issues,
			lengthM: projection.lengthM,
			qualityFlags: [...new Set(issues.map((issue) => issue.code))],
			routeId: entry.routeId,
			routeName: entry.routeName,
			routeType,
			segments,
			stops,
		},
		routeType,
	};
}

const isMissingRaw = (issue: BusIssue): boolean =>
	issue.code === "missing-stations" || issue.code === "missing-path";

/**
 * 노선 원본을 모두 조립하고 적재 여부(ok)를 정한다.
 * ok: 수집이 끝났고(missingRaw 없음) 범위 안 노선 중 적재 가능한 비율이 MIN_VALID_ROUTE_RATIO 이상.
 * 출처 일부 결함으로 전체를 막지 않되, 수집이 덜 된 배치가 현재 배치를 덮어쓰지 않게 한다.
 */
export function assembleBusRoutes(
	raws: readonly BusRouteRaw[]
): BusAssembleResult {
	const routes: AssembledBusRoute[] = [];
	const excluded: BusAssembleResult["excluded"] = [];
	const missingRaw: string[] = [];
	const routeTypeCounts: Record<string, number> = {};
	const seen = new Set<string>();
	let outOfScope = 0;
	for (const raw of raws) {
		const { routeId, routeName } = raw.entry;
		// 엑셀 리더가 routeId를 합치므로 중복은 호출 쪽 버그다. 그대로 두면 적재 때 유일 제약에 걸린다.
		if (seen.has(routeId)) {
			throw new Error(`assembleBusRoutes: duplicate routeId ${routeId}`);
		}
		seen.add(routeId);
		const assembled = assembleBusRoute(raw);
		if (assembled.routeType !== undefined) {
			routeTypeCounts[assembled.routeType] =
				(routeTypeCounts[assembled.routeType] ?? 0) + 1;
		}
		if (assembled.outOfScope) {
			outOfScope += 1;
		} else if (assembled.issues.some(isMissingRaw)) {
			missingRaw.push(routeId);
		} else if (assembled.route) {
			routes.push(assembled.route);
		} else {
			excluded.push({
				issues: assembled.issues.filter((issue) => issue.level === "error"),
				routeId,
				routeName,
			});
		}
	}
	const inScope = routes.length + excluded.length;
	const ok =
		missingRaw.length === 0 &&
		inScope > 0 &&
		routes.length / inScope >= MIN_VALID_ROUTE_RATIO;
	const result = {
		excluded,
		missingRaw,
		ok,
		outOfScope,
		routes,
		routeTypeCounts,
	};
	return { ...result, markdown: renderBusRouteReport(result) };
}

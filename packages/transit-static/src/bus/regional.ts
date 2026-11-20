import { lineString } from "@turf/helpers";
import length from "@turf/length";
import {
	parseGbisRouteInfo,
	parseGbisRouteStations,
} from "../sources/gbis-api";
import type {
	RegionalEnvelope,
	RegionalRouteInfo,
	RegionalRouteRow,
	RegionalStopRow,
} from "../sources/regional-bus-types";
import {
	parseTagoRouteInfo,
	parseTagoRouteStations,
} from "../sources/tago-api";
import type { AssembledBusRoute, BusIssue } from "./assemble";
import type { BusSegment } from "./project-stops";
import {
	type BusRegion,
	isInScopeRegionalRoute,
	type RegionalBusSource,
} from "./scope";

/**
 * 경기(GBIS)·인천(TAGO) 노선을 bus_route 적재 형태로 조립한다.
 * 두 출처 모두 모양 API가 없어 경유 정류장 좌표를 순서대로 이은 선을 모양으로 쓴다(실험 1절, 계획 설계 판단 3).
 * 정류장 거리는 이 선 위의 누적 거리이고 offset_m과 api_sect_dist_m은 0이다.
 */

/** 출처별로 범위 안 노선 중 적재 가능한 노선이 이 비율 이상이어야 배치를 적재한다. */
export const regionalMinLoadableRatio = 0.9;

/** 정류장 좌표로 모양을 만든 노선에 붙이는 품질 표시. */
export const SHAPE_FROM_STOPS_FLAG = "shape-from-stops";

const MIN_STOPS = 2;
const METERS_PER_KILOMETER = 1000;
/** 오류 detail에 보여 줄 seq 수. */
const DETAIL_SAMPLE = 5;

/** TAGO 인천 노선 ID(`ICB` + 숫자). 첫 자리에서 2를 빼면 서울 busRouteId다(실험 1절 5-A 확인). */
const TAGO_ICB_ROUTE_ID = /^ICB(\d)(\d+)$/;
const ICB_PREFIX_OFFSET = 2;

const REGION_BY_SOURCE: Readonly<Record<RegionalBusSource, BusRegion>> = {
	gbis: "gyeonggi",
	tago: "incheon",
};

export interface RegionalRouteInput {
	info: RegionalRouteInfo | null;
	route: RegionalRouteRow;
	source: RegionalBusSource;
	stops: RegionalStopRow[];
}

export type RegionalAssembleResult =
	| { ok: true; route: AssembledBusRoute }
	| { ok: false; issue: BusIssue };

const error = (code: string, detail: string): BusIssue => ({
	code,
	detail,
	level: "error",
});

const sample = (values: readonly number[]): string =>
	values.length > DETAIL_SAMPLE
		? `${values.slice(0, DETAIL_SAMPLE).join(", ")} 외 ${values.length - DETAIL_SAMPLE}개`
		: values.join(", ");

/** 좌표가 0이거나 숫자가 아닌 정류장 seq. 원천이 좌표를 모를 때 0을 넣는다. */
function badCoordinateSeqs(stops: readonly RegionalStopRow[]): number[] {
	return stops
		.filter(
			(stop) =>
				!(Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) ||
				stop.lat === 0 ||
				stop.lng === 0
		)
		.map((stop) => stop.seq);
}

/** seq가 앞 정류장보다 크지 않은 정류장 seq. 겹치면 (노선, seq) 유일 색인에 걸려 적재 전체가 멈춘다. */
function nonIncreasingSeqs(stops: readonly RegionalStopRow[]): number[] {
	const problems: number[] = [];
	for (let i = 1; i < stops.length; i += 1) {
		const previous = stops[i - 1];
		const current = stops[i];
		if (previous && current && current.seq <= previous.seq) {
			problems.push(current.seq);
		}
	}
	return problems;
}

function validateStops(stops: readonly RegionalStopRow[]): BusIssue | null {
	if (stops.length < MIN_STOPS) {
		return error("too-few-stops", `${stops.length} stops`);
	}
	const badCoords = badCoordinateSeqs(stops);
	if (badCoords.length > 0) {
		return error("bad-stop-coordinate", `seq ${sample(badCoords)}`);
	}
	const badSeqs = nonIncreasingSeqs(stops);
	if (badSeqs.length > 0) {
		return error("seq-not-increasing", `seq ${sample(badSeqs)}`);
	}
	return null;
}

/** 첫 정류장부터 각 정류장까지 선 위 누적 거리(미터). */
function cumulativeDistances(coords: readonly [number, number][]): number[] {
	const distances = [0];
	for (let i = 1; i < coords.length; i += 1) {
		const from = coords[i - 1];
		const to = coords[i];
		if (!(from && to)) {
			throw new Error(`cumulativeDistances: missing coordinate at ${i}`);
		}
		const stepM =
			length(lineString([from, to]), { units: "kilometers" }) *
			METERS_PER_KILOMETER;
		distances.push((distances[i - 1] ?? 0) + stepM);
	}
	return distances;
}

/**
 * 노선 하나를 조립한다. 정류장이 2개 미만이거나, 좌표가 0인 정류장이 있거나, seq가 겹치면 뺀다.
 * 정류장 ID와 노선 ID는 원본 그대로 둔다. 출처 접두사(`gbis:`, `tago:`)는 참조 API에서 붙인다.
 */
export function assembleRegionalRoute({
	info,
	route,
	source,
	stops: input,
}: RegionalRouteInput): RegionalAssembleResult {
	const stops = [...input].sort((a, b) => a.seq - b.seq);
	const issue = validateStops(stops);
	if (issue) {
		return { issue, ok: false };
	}
	const coords = stops.map((stop): [number, number] => [stop.lng, stop.lat]);
	const distances = cumulativeDistances(coords);
	const assembledStops = stops.map((stop, i) => ({
		apiSectDistM: 0,
		arsId: stop.arsId,
		directionName: null,
		distanceM: distances[i] ?? 0,
		flags: [],
		lat: stop.lat,
		lng: stop.lng,
		name: stop.name,
		offsetM: 0,
		routeName: route.name,
		routeType: route.routeTypeCode,
		seq: stop.seq,
		stationId: stop.stationId,
	}));
	const segments: BusSegment[] = [];
	for (let i = 1; i < assembledStops.length; i += 1) {
		const from = assembledStops[i - 1];
		const to = assembledStops[i];
		if (!(from && to)) {
			throw new Error(`assembleRegionalRoute: missing stop at ${i}`);
		}
		// 정류장 좌표를 이은 선이라 서울 노선의 구간 거리 비교(sect-dist-mismatch)는 하지 않는다.
		segments.push({
			apiSectDistM: 0,
			endM: to.distanceM,
			flags: to.distanceM === from.distanceM ? ["zero-length-segment"] : [],
			fromSeq: from.seq,
			startM: from.distanceM,
			toSeq: to.seq,
		});
	}
	const segmentFlags = segments.flatMap((segment) => segment.flags);
	return {
		ok: true,
		route: {
			areaName: route.areaName,
			coords,
			firstBusMinute: info?.firstBusMinute ?? null,
			headwayMin: info?.headwayMin ?? null,
			issues: [],
			lastBusMinute: info?.lastBusMinute ?? null,
			lengthM: distances.at(-1) ?? 0,
			qualityFlags: [...new Set([SHAPE_FROM_STOPS_FLAG, ...segmentFlags])],
			region: REGION_BY_SOURCE[source],
			routeId: route.routeId,
			routeName: route.name,
			routeType: route.routeTypeCode,
			segments,
			shortName: route.name,
			source,
			sourceCity: route.cityCode,
			stops: assembledStops,
		},
	};
}

/** TAGO `ICB` 노선 ID를 서울 busRouteId로 바꾼다. 첫 자리가 2보다 작으면 서울 노선이 아니므로 null. */
function tagoSeoulRouteId(routeId: string): string | null {
	const match = TAGO_ICB_ROUTE_ID.exec(routeId);
	const head = Number(match?.[1]);
	if (!match || head < ICB_PREFIX_OFFSET) {
		return null;
	}
	return `${head - ICB_PREFIX_OFFSET}${match[2]}`;
}

/**
 * 서울 노선 목록에 이미 있는 노선인지(서울에 들어오는 routeType 7·8). 서울 쪽이 이긴다.
 * GBIS는 routeId가 서울 ID와 같고, TAGO는 `ICB` 변환으로 같은 ID가 된다.
 * 계획은 TAGO에 정류장 열 비교를 제안했지만 실험 1절 5-A 확인에서 M6458을 놓쳐 노선 ID 규칙으로 정했다.
 */
export function isSeoulDuplicate(
	source: RegionalBusSource,
	routeId: string,
	seoulRouteIds: ReadonlySet<string>
): boolean {
	const seoulId = source === "gbis" ? routeId : tagoSeoulRouteId(routeId);
	return seoulId !== null && seoulRouteIds.has(seoulId);
}

/** 서울 노선과 겹치는 GBIS·TAGO 노선을 버린다. 지금 저장된 장소의 `seoul-bus:` 참조가 그대로 살게 한다. */
export function dropSeoulDuplicates(
	regional: readonly AssembledBusRoute[],
	seoul: { routeIds: ReadonlySet<string> }
): { kept: AssembledBusRoute[]; dropped: number } {
	const kept: AssembledBusRoute[] = [];
	let dropped = 0;
	for (const route of regional) {
		const source = route.source ?? "seoul";
		if (
			source !== "seoul" &&
			isSeoulDuplicate(source, route.routeId, seoul.routeIds)
		) {
			dropped += 1;
			continue;
		}
		kept.push(route);
	}
	return { dropped, kept };
}

/** 노선 하나의 저장된 원본 본문. 받지 못한 단계는 없다. */
export interface RegionalRouteRaw {
	infoBody?: string;
	stationsBody?: string;
}

export interface RegionalExcludedRoute {
	issues: BusIssue[];
	routeId: string;
	routeName: string;
}

export interface RegionalSourceResult {
	/** 서울 노선과 겹쳐 버린 노선 수. 비율에 넣지 않는다. */
	duplicates: number;
	excluded: RegionalExcludedRoute[];
	/** 범위 안이고 서울과 겹치지 않는 노선 수(적재 + 제외 + 원본 없음). */
	inScope: number;
	loadable: number;
	/** 적재 가능 비율 기준. 보고서가 쓴다. */
	minRatio: number;
	/** 경유 정류장 원본이 아직 없는 노선 ID. 적재 가능 수에 들지 않는다. */
	missingRaw: string[];
	ok: boolean;
	/** 시외·고속·공항 유형으로 뺀 노선 수. */
	outOfScope: number;
	routes: AssembledBusRoute[];
	source: RegionalBusSource;
}

const RESULT_ERROR_REASONS = new Set(["no-data", "malformed"]);

function parseStations(
	source: RegionalBusSource,
	body: string,
	cityCode: string
): RegionalEnvelope<RegionalStopRow> {
	const json: unknown = JSON.parse(body);
	return source === "gbis"
		? parseGbisRouteStations(json)
		: parseTagoRouteStations(json, cityCode);
}

/** 노선 정보는 배차간격·첫차·막차만 준다. 없거나 못 읽으면 null(시각 없이 적재한다). */
function parseInfo(
	source: RegionalBusSource,
	body: string | undefined,
	cityCode: string
): RegionalRouteInfo | null {
	if (body === undefined) {
		return null;
	}
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return null;
	}
	const parsed =
		source === "gbis"
			? parseGbisRouteInfo(json)
			: parseTagoRouteInfo(json, cityCode);
	return parsed.ok ? (parsed.items[0] ?? null) : null;
}

/** 저장된 경유 정류장 본문을 읽는다. 받은 본문인데 쓸 수 없으면 issue. */
function readStops(
	source: RegionalBusSource,
	body: string,
	cityCode: string
): { stops: RegionalStopRow[] } | { issue: BusIssue } {
	let parsed: RegionalEnvelope<RegionalStopRow>;
	try {
		parsed = parseStations(source, body, cityCode);
	} catch {
		return { issue: error("bad-envelope", "stations raw is not JSON") };
	}
	if (parsed.ok) {
		return { stops: parsed.items };
	}
	const code = RESULT_ERROR_REASONS.has(parsed.reason)
		? `stations-${parsed.reason}`
		: "bad-envelope";
	return { issue: error(code, `stations ${parsed.reason}`) };
}

/**
 * 한 출처의 노선 목록과 원본을 모두 조립하고 적재 여부(ok)를 정한다.
 * - 시외·고속·공항 유형은 범위 밖으로 센다.
 * - 서울 노선과 겹치는 노선은 원본 유무와 상관없이 버리고 비율에 넣지 않는다.
 * - 경유 정류장 원본이 없는 노선은 적재 가능 수에 들지 않으므로, 받은 만큼만 적재하지 않고 비율 기준으로 막는다.
 * - 목록이 비어 범위 안 노선이 없으면 ok다(그 출처를 아직 받지 않음).
 */
export function assembleRegionalSource({
	raws,
	routes,
	seoulRouteIds,
	source,
}: {
	raws: ReadonlyMap<string, RegionalRouteRaw>;
	routes: readonly RegionalRouteRow[];
	seoulRouteIds: ReadonlySet<string>;
	source: RegionalBusSource;
}): RegionalSourceResult {
	const assembled: AssembledBusRoute[] = [];
	const excluded: RegionalExcludedRoute[] = [];
	const missingRaw: string[] = [];
	const seen = new Set<string>();
	let outOfScope = 0;
	let duplicates = 0;
	for (const route of routes) {
		// 수집 job이 목록을 routeId로 합치므로 중복은 호출 쪽 버그다. 그대로 두면 적재 때 유일 제약에 걸린다.
		if (seen.has(route.routeId)) {
			throw new Error(
				`assembleRegionalSource: duplicate ${source} routeId ${route.routeId}`
			);
		}
		seen.add(route.routeId);
		if (!isInScopeRegionalRoute(source, route.routeTypeCode)) {
			outOfScope += 1;
			continue;
		}
		// 서울 노선과 겹치는 노선은 원본이 없거나 못 읽어도 서울 쪽이 이기므로 비율에 넣지 않는다.
		if (isSeoulDuplicate(source, route.routeId, seoulRouteIds)) {
			duplicates += 1;
			continue;
		}
		const raw = raws.get(route.routeId);
		if (raw?.stationsBody === undefined) {
			missingRaw.push(route.routeId);
			continue;
		}
		const cityCode = route.cityCode ?? "";
		const read = readStops(source, raw.stationsBody, cityCode);
		const result =
			"issue" in read
				? read
				: assembleRegionalRoute({
						info: parseInfo(source, raw.infoBody, cityCode),
						route,
						source,
						stops: read.stops,
					});
		if ("route" in result) {
			assembled.push(result.route);
		} else {
			excluded.push({
				issues: [result.issue],
				routeId: route.routeId,
				routeName: route.name,
			});
		}
	}
	const inScope = assembled.length + excluded.length + missingRaw.length;
	return {
		duplicates,
		excluded,
		inScope,
		loadable: assembled.length,
		minRatio: regionalMinLoadableRatio,
		missingRaw,
		ok: inScope === 0 || assembled.length / inScope >= regionalMinLoadableRatio,
		outOfScope,
		routes: assembled,
		source,
	};
}

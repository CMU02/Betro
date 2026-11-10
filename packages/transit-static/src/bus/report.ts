// assemble.ts가 이 모듈의 값을 쓰므로 여기서는 타입만 가져온다(import 순환 방지).
import type {
	AssembledBusRoute,
	BusAssembleResult,
	LoadableGroup,
} from "./assemble";
import {
	AUTONOMOUS_PILOT_ROUTES,
	AUTONOMOUS_ROUTE_NAME,
	type BusRegion,
	OUT_OF_SCOPE_ROUTE_ID_REASON,
} from "./scope";

/** 보고서 출처 줄. 계획의 인터페이스 이름(BUS_SHAPE_ATTRIBUTION)으로는 assemble.ts가 내보낸다. */
export const REPORT_SHAPE_ATTRIBUTION =
	"서울특별시 버스노선정보(공공데이터포털)";

/**
 * 묶음별 적재 가능 비율 기준. assemble.ts가 MIN_VALID_ROUTE_RATIO, MIN_VALID_REGIONAL_ROUTE_RATIO로 내보낸다.
 * 값은 여기에 둔다. report.ts가 assemble.ts에서 타입만 가져오게 해 import 순환을 끊는다.
 */
export const REPORT_MIN_LOADABLE_RATIO: Readonly<
	Record<LoadableGroup, number>
> = {
	regional: 0.9,
	seoul: 0.98,
};
const LOADABLE_GROUPS: readonly LoadableGroup[] = ["seoul", "regional"];
const REGIONS: readonly BusRegion[] = ["seoul", "gyeonggi", "incheon"];
const PERCENT = 100;
const PERCENT_DIGITS = 1;

/** 오프셋·stop-off-shape 정류소·sect-dist-mismatch 표에 보여 줄 항목 수. */
const TOP_N = 20;
/** 원본 없는 노선 목록에 보여 줄 ID 수. 첫 수집 중에는 수백 개일 수 있다. */
const MISSING_LIST_MAX = 50;
const PIPE = /\|/g;
const ESCAPED_PIPE = String.raw`\|`;
const LINE_BREAK = /\r\n|\r|\n/g;
/** sect-dist-mismatch 묶음마다 보여 줄 예시 노선 수. */
const EXAMPLE_ROUTES_MAX = 3;

type ReportInput = Omit<BusAssembleResult, "markdown">;

/** 표 칸 하나. | 는 이스케이프하고 줄바꿈은 공백으로 바꿔 행이 깨지지 않게 한다. */
const cell = (value: string): string =>
	value.replace(LINE_BREAK, " ").replace(PIPE, ESCAPED_PIPE);

function renderSummary(result: ReportInput): string[] {
	const inScope = result.routes.length + result.excluded.length;
	const total = inScope + result.missingRaw.length + result.outOfScope;
	return [
		"# 버스 노선 조립 보고서",
		"",
		`ok: ${result.ok}`,
		`엑셀 노선: ${total}`,
		`범위 안: ${inScope} (적재 ${result.routes.length}, 제외 ${result.excluded.length})`,
		`범위 밖: ${result.outOfScope} (유형 ${result.outOfScope - result.outOfScopeById.length}, ID ${result.outOfScopeById.length})`,
		`원본 없음: ${result.missingRaw.length}`,
		`정류소: ${result.routes.reduce((sum, r) => sum + r.stops.length, 0)}, 구간: ${result.routes.reduce((sum, r) => sum + r.segments.length, 0)}`,
		`출처: ${REPORT_SHAPE_ATTRIBUTION}`,
		"",
	];
}

/** routeType은 숫자 문자열이 대부분이므로 숫자 순서, 아니면 문자열 순서. */
function compareRouteType(a: string, b: string): number {
	const diff = Number(a) - Number(b);
	return Number.isNaN(diff) || diff === 0 ? a.localeCompare(b) : diff;
}

function renderRouteTypes(result: ReportInput): string[] {
	const entries = Object.entries(result.routeTypeCounts).toSorted(([a], [b]) =>
		compareRouteType(a, b)
	);
	if (entries.length === 0) {
		return ["## routeType별 노선 수", "", "없음", ""];
	}
	return [
		"## routeType별 노선 수",
		"",
		"| routeType | 노선 수 |",
		"| --- | --- |",
		...entries.map(([routeType, count]) => `| ${cell(routeType)} | ${count} |`),
		"",
	];
}

function renderRegions(result: ReportInput): string[] {
	return [
		"## 지역별 노선 수",
		"",
		"범위 안 노선(적재 + 제외). 마을버스는 seoul에 든다.",
		"",
		"| region | 노선 수 |",
		"| --- | --- |",
		...REGIONS.map(
			(region) => `| ${region} | ${result.regionCounts[region]} |`
		),
		"",
	];
}

function renderLoadableRatios(result: ReportInput): string[] {
	return [
		"## 적재 가능 비율",
		"",
		"seoul은 서울 면허 노선(마을 포함), regional은 경기·인천 노선. regional이 0개면 seoul만 본다.",
		"",
		"| 묶음 | 적재 가능 | 범위 안 | 비율 | 기준 |",
		"| --- | --- | --- | --- | --- |",
		...LOADABLE_GROUPS.map((group) => {
			const { inScope, loadable } = result.loadable[group];
			const ratio =
				inScope === 0
					? "-"
					: `${((loadable / inScope) * PERCENT).toFixed(PERCENT_DIGITS)}%`;
			const minimum = `${REPORT_MIN_LOADABLE_RATIO[group] * PERCENT}%`;
			return `| ${group} | ${loadable} | ${inScope} | ${ratio} | ${minimum} |`;
		}),
		"",
	];
}

function renderOutOfScopeById(result: ReportInput): string[] {
	const { outOfScopeById } = result;
	if (outOfScopeById.length === 0) {
		return ["## ID로 뺀 노선", "", "없음", ""];
	}
	return [
		`## ID로 뺀 노선 (${outOfScopeById.length})`,
		"",
		"| 노선명 | ID | routeType | 사유 |",
		"| --- | --- | --- | --- |",
		...outOfScopeById.map(
			(route) =>
				`| ${cell(route.routeName)} | ${cell(route.routeId)} | ${cell(route.routeType)} | ${cell(OUT_OF_SCOPE_ROUTE_ID_REASON)} |`
		),
		"",
	];
}

/**
 * 범위 안 자율주행 시범버스(AUTONOMOUS_PILOT_ROUTES 또는 이름 패턴). 2026-11-02부터 범위에 넣으므로 목록으로만 보인다.
 * 이름 패턴에 맞지만 AUTONOMOUS_PILOT_ROUTES에 없는 노선은 "새 노선"으로 표시해 목록 갱신을 검토하게 한다. ok는 바꾸지 않는다.
 */
function renderAutonomousReview(result: ReportInput): string[] {
	const heading = "## 범위 안 자율주행 시범버스";
	const pilots = [...result.routes, ...result.excluded]
		.filter(
			(route) =>
				AUTONOMOUS_PILOT_ROUTES.has(route.routeId) ||
				AUTONOMOUS_ROUTE_NAME.test(route.routeName)
		)
		.toSorted((a, b) => a.routeId.localeCompare(b.routeId));
	if (pilots.length === 0) {
		return [heading, "", "없음", ""];
	}
	return [
		`${heading} (${pilots.length})`,
		"",
		"| 노선명 | ID | 목록 |",
		"| --- | --- | --- |",
		...pilots.map(
			(route) =>
				`| ${cell(route.routeName)} | ${cell(route.routeId)} | ${AUTONOMOUS_PILOT_ROUTES.has(route.routeId) ? "알려진 노선" : "새 노선"} |`
		),
		"",
	];
}

function renderExcluded(result: ReportInput): string[] {
	if (result.excluded.length === 0) {
		return ["## 제외 노선", "", "없음", ""];
	}
	return [
		`## 제외 노선 (${result.excluded.length})`,
		"",
		"| 노선명 | ID | error | detail | region |",
		"| --- | --- | --- | --- | --- |",
		...result.excluded.map((route) => {
			const codes = [...new Set(route.issues.map((issue) => issue.code))];
			const detail = route.issues.map((issue) => issue.detail).join("; ");
			return `| ${cell(route.routeName)} | ${cell(route.routeId)} | ${cell(codes.join(", "))} | ${cell(detail)} | ${route.region} |`;
		}),
		"",
	];
}

function renderMissingRaw(result: ReportInput): string[] {
	const { missingRaw } = result;
	if (missingRaw.length === 0) {
		return ["## 원본 없는 노선", "", "없음", ""];
	}
	const rest = missingRaw.length - MISSING_LIST_MAX;
	return [
		`## 원본 없는 노선 (${missingRaw.length})`,
		"",
		...missingRaw
			.slice(0, MISSING_LIST_MAX)
			.map((routeId) => `- ${cell(routeId)}`),
		...(rest > 0 ? [`- 외 ${rest}개`] : []),
		"",
	];
}

function renderWarningCounts(routes: readonly AssembledBusRoute[]): string[] {
	const counts = new Map<string, number>();
	for (const route of routes) {
		for (const issue of route.issues) {
			if (issue.level === "warning") {
				counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
			}
		}
	}
	if (counts.size === 0) {
		return ["## warning", "", "없음", ""];
	}
	return [
		"## warning",
		"",
		"| code | 개수 | 노선 수 |",
		"| --- | --- | --- |",
		...[...counts.entries()]
			.toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b))
			.map(
				([code, count]) =>
					`| ${cell(code)} | ${count} | ${routes.filter((r) => r.qualityFlags.includes(code)).length} |`
			),
		"",
	];
}

interface OffShapeStation {
	count: number;
	maxOffsetM: number;
	name: string;
	routeIds: Set<string>;
	routeNames: Set<string>;
	stationId: string;
}

/** stop-off-shape를 정류소(stationId)별로 묶는다. issues에는 stationId가 없으므로 stops를 읽는다. */
function renderStopOffShapeByStation(
	routes: readonly AssembledBusRoute[]
): string[] {
	const groups = new Map<string, OffShapeStation>();
	for (const route of routes) {
		for (const stop of route.stops) {
			if (!stop.flags.includes("stop-off-shape")) {
				continue;
			}
			const group = groups.get(stop.stationId) ?? {
				count: 0,
				maxOffsetM: 0,
				name: stop.name,
				routeIds: new Set<string>(),
				routeNames: new Set<string>(),
				stationId: stop.stationId,
			};
			group.count += 1;
			group.maxOffsetM = Math.max(group.maxOffsetM, stop.offsetM);
			group.routeIds.add(route.routeId);
			group.routeNames.add(route.routeName);
			groups.set(stop.stationId, group);
		}
	}
	const heading = `## stop-off-shape 정류소별 (${groups.size}개 정류소)`;
	if (groups.size === 0) {
		return [heading, "", "없음", ""];
	}
	const rows = [...groups.values()].toSorted(
		(a, b) =>
			b.count - a.count ||
			b.maxOffsetM - a.maxOffsetM ||
			a.stationId.localeCompare(b.stationId)
	);
	const rest = groups.size - TOP_N;
	return [
		heading,
		"",
		"| stationId | 정류소 | 경고 수 | 노선 수 | 최대 오프셋(m) | 노선 예시 |",
		"| --- | --- | --- | --- | --- | --- |",
		...rows.slice(0, TOP_N).map((group) => {
			const examples = [...group.routeNames]
				.toSorted((a, b) => a.localeCompare(b))
				.slice(0, EXAMPLE_ROUTES_MAX)
				.join(", ");
			return `| ${cell(group.stationId)} | ${cell(group.name)} | ${group.count} | ${group.routeIds.size} | ${group.maxOffsetM.toFixed(1)} | ${cell(examples)} |`;
		}),
		...(rest > 0 ? [`- 외 ${rest}개 정류소`] : []),
		"",
	];
}

function renderTopOffsets(routes: readonly AssembledBusRoute[]): string[] {
	const top = routes
		.flatMap((route) => route.stops.map((stop) => ({ route, stop })))
		.toSorted((a, b) => b.stop.offsetM - a.stop.offsetM)
		.slice(0, TOP_N);
	if (top.length === 0) {
		return [`## 오프셋 상위 ${TOP_N}개 정류소`, "", "없음", ""];
	}
	return [
		`## 오프셋 상위 ${TOP_N}개 정류소`,
		"",
		"| 노선명 | ID | seq | 정류소 | 오프셋(m) | 모양 위 거리(m) | flags |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...top.map(
			({ route, stop }) =>
				`| ${cell(route.routeName)} | ${cell(route.routeId)} | ${stop.seq} | ${cell(stop.name)} | ${stop.offsetM.toFixed(1)} | ${stop.distanceM.toFixed(0)} | ${cell(stop.flags.join(", "))} |`
		),
		"",
	];
}

interface MismatchGroup {
	apiSectDistM: number;
	/** 같은 정류소 쌍의 경고 구간 예시. 노선명 순. */
	examples: {
		fromSeq: number;
		routeId: string;
		routeName: string;
		toSeq: number;
	}[];
	fromName: string;
	key: string;
	maxDiffM: number;
	maxLengthM: number;
	minLengthM: number;
	pairKey: string;
	toName: string;
}

type RouteStop = AssembledBusRoute["stops"][number];

function stopAt(
	bySeq: ReadonlyMap<number, RouteStop>,
	route: AssembledBusRoute,
	seq: number
): RouteStop {
	const stop = bySeq.get(seq);
	if (!stop) {
		throw new Error(
			`renderTopMismatches: route ${route.routeId} has no stop at seq ${seq}`
		);
	}
	return stop;
}

/**
 * 경고 구간을 (from stationId, to stationId, apiSectDistM)으로 묶고, 같은 정류소 쌍을 지나는 전체 노선 수를 함께 센다.
 * 여러 노선이 같은 링크를 공유하면 한 줄로 보이고, "경고 노선 / 같은 구간 전체 노선"으로 링크 결함(16/16)과
 * 한 노선만의 결함(1/11)을 가른다.
 */
function groupMismatches(routes: readonly AssembledBusRoute[]): {
	flagged: number;
	groups: MismatchGroup[];
	routesByPair: Map<string, Set<string>>;
} {
	const groups = new Map<string, MismatchGroup>();
	const routesByPair = new Map<string, Set<string>>();
	let flagged = 0;
	for (const route of routes) {
		const bySeq = new Map(route.stops.map((stop) => [stop.seq, stop]));
		for (const segment of route.segments) {
			const from = stopAt(bySeq, route, segment.fromSeq);
			const to = stopAt(bySeq, route, segment.toSeq);
			const pairKey = `${from.stationId}>${to.stationId}`;
			const onPair = routesByPair.get(pairKey) ?? new Set<string>();
			onPair.add(route.routeId);
			routesByPair.set(pairKey, onPair);
			if (!segment.flags.includes("sect-dist-mismatch")) {
				continue;
			}
			flagged += 1;
			const lengthM = segment.endM - segment.startM;
			const diffM = Math.abs(lengthM - segment.apiSectDistM);
			const key = `${pairKey}>${segment.apiSectDistM}`;
			const group = groups.get(key) ?? {
				apiSectDistM: segment.apiSectDistM,
				examples: [],
				fromName: from.name,
				key,
				maxDiffM: 0,
				maxLengthM: lengthM,
				minLengthM: lengthM,
				pairKey,
				toName: to.name,
			};
			group.maxDiffM = Math.max(group.maxDiffM, diffM);
			group.minLengthM = Math.min(group.minLengthM, lengthM);
			group.maxLengthM = Math.max(group.maxLengthM, lengthM);
			group.examples.push({
				fromSeq: segment.fromSeq,
				routeId: route.routeId,
				routeName: route.routeName,
				toSeq: segment.toSeq,
			});
			groups.set(key, group);
		}
	}
	return { flagged, groups: [...groups.values()], routesByPair };
}

function lengthRange(group: MismatchGroup): string {
	const min = group.minLengthM.toFixed(0);
	const max = group.maxLengthM.toFixed(0);
	return min === max ? min : `${min}–${max}`;
}

function exampleRoutes(group: MismatchGroup): string {
	const examples = group.examples
		.toSorted(
			(a, b) => a.routeName.localeCompare(b.routeName) || a.fromSeq - b.fromSeq
		)
		.map((e) => `${e.routeName}(${e.fromSeq}→${e.toSeq})`);
	const rest = examples.length - EXAMPLE_ROUTES_MAX;
	const shown = examples.slice(0, EXAMPLE_ROUTES_MAX).join(", ");
	return rest > 0 ? `${shown} 외 ${rest}` : shown;
}

function renderTopMismatches(routes: readonly AssembledBusRoute[]): string[] {
	const heading = `## sect-dist-mismatch 상위 ${TOP_N}개 구간`;
	const { flagged, groups, routesByPair } = groupMismatches(routes);
	if (groups.length === 0) {
		return [heading, "", "없음", ""];
	}
	const flaggedRoutes = (group: MismatchGroup): number =>
		new Set(group.examples.map((e) => e.routeId)).size;
	const top = groups
		.toSorted(
			(a, b) =>
				b.maxDiffM - a.maxDiffM ||
				b.examples.length - a.examples.length ||
				a.key.localeCompare(b.key)
		)
		.slice(0, TOP_N);
	return [
		heading,
		"",
		`정류소 쌍·API 거리 기준 묶음 ${groups.length}개 (경고 구간 ${flagged}개)`,
		"",
		"| 구간 | 모양 길이(m) | API 거리(m) | 차이(m) | 경고 노선 / 같은 구간 전체 노선 | 예시 노선 |",
		"| --- | --- | --- | --- | --- | --- |",
		...top.map((group) => {
			const total = routesByPair.get(group.pairKey)?.size ?? 0;
			return `| ${cell(`${group.fromName} → ${group.toName}`)} | ${lengthRange(group)} | ${group.apiSectDistM} | ${group.maxDiffM.toFixed(0)} | ${flaggedRoutes(group)}/${total} | ${cell(exampleRoutes(group))} |`;
		}),
		"",
	];
}

/** build-bus-routes 보고서 Markdown. */
export function renderBusRouteReport(result: ReportInput): string {
	return [
		...renderSummary(result),
		...renderRouteTypes(result),
		...renderRegions(result),
		...renderLoadableRatios(result),
		...renderOutOfScopeById(result),
		...renderAutonomousReview(result),
		...renderExcluded(result),
		...renderMissingRaw(result),
		...renderWarningCounts(result.routes),
		...renderStopOffShapeByStation(result.routes),
		...renderTopOffsets(result.routes),
		...renderTopMismatches(result.routes),
	].join("\n");
}

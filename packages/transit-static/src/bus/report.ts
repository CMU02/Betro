// assemble.ts가 이 모듈의 값을 쓰므로 여기서는 타입만 가져온다(import 순환 방지).
import type { AssembledBusRoute, BusAssembleResult } from "./assemble";

/** 보고서 출처 줄. 계획의 인터페이스 이름(BUS_SHAPE_ATTRIBUTION)으로는 assemble.ts가 내보낸다. */
export const REPORT_SHAPE_ATTRIBUTION =
	"서울특별시 버스노선정보(공공데이터포털)";

/** 오프셋·sect-dist-mismatch 표에 보여 줄 항목 수. */
const TOP_N = 20;
/** 원본 없는 노선 목록에 보여 줄 ID 수. 첫 수집 중에는 수백 개일 수 있다. */
const MISSING_LIST_MAX = 50;
const PIPE = /\|/g;
const ESCAPED_PIPE = String.raw`\|`;
const LINE_BREAK = /\r\n|\r|\n/g;

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
		`범위 밖: ${result.outOfScope}`,
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

function renderExcluded(result: ReportInput): string[] {
	if (result.excluded.length === 0) {
		return ["## 제외 노선", "", "없음", ""];
	}
	return [
		`## 제외 노선 (${result.excluded.length})`,
		"",
		"| 노선명 | ID | error | detail |",
		"| --- | --- | --- | --- |",
		...result.excluded.map((route) => {
			const codes = [...new Set(route.issues.map((issue) => issue.code))];
			const detail = route.issues.map((issue) => issue.detail).join("; ");
			return `| ${cell(route.routeName)} | ${cell(route.routeId)} | ${cell(codes.join(", "))} | ${cell(detail)} |`;
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

function renderTopMismatches(routes: readonly AssembledBusRoute[]): string[] {
	const top = routes
		.flatMap((route) =>
			route.segments
				.filter((segment) => segment.flags.includes("sect-dist-mismatch"))
				.map((segment) => ({
					diffM: Math.abs(segment.endM - segment.startM - segment.apiSectDistM),
					route,
					segment,
				}))
		)
		.toSorted((a, b) => b.diffM - a.diffM)
		.slice(0, TOP_N);
	if (top.length === 0) {
		return [`## sect-dist-mismatch 상위 ${TOP_N}개 구간`, "", "없음", ""];
	}
	return [
		`## sect-dist-mismatch 상위 ${TOP_N}개 구간`,
		"",
		"| 노선명 | ID | 구간(seq) | 모양 길이(m) | API 거리(m) | 차이(m) |",
		"| --- | --- | --- | --- | --- | --- |",
		...top.map(
			({ route, segment, diffM }) =>
				`| ${cell(route.routeName)} | ${cell(route.routeId)} | ${segment.fromSeq}→${segment.toSeq} | ${(segment.endM - segment.startM).toFixed(0)} | ${segment.apiSectDistM} | ${diffM.toFixed(0)} |`
		),
		"",
	];
}

/** build-bus-routes 보고서 Markdown. */
export function renderBusRouteReport(result: ReportInput): string {
	return [
		...renderSummary(result),
		...renderRouteTypes(result),
		...renderExcluded(result),
		...renderMissingRaw(result),
		...renderWarningCounts(result.routes),
		...renderTopOffsets(result.routes),
		...renderTopMismatches(result.routes),
	].join("\n");
}

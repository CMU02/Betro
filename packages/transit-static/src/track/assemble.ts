import type {
	TrackDirection,
	TrackStationAnchor,
} from "@Betro/db/schema/transit";
import type { CrosswalkRow } from "../crosswalk/match";
import type { TrackShapeInput } from "../db/load";
import { LINES, type LineKey } from "../lines";
import { isClosed, type NodeLine, rotateToNode } from "./loop";
import {
	type OsmIndex,
	type OsmNode,
	stopNodesOf,
	wayMembersOf,
} from "./osm-model";
import { type PlacementResult, placeStations } from "./place";
import { lineLengthM } from "./project";
import { type StitchResult, stitchWays } from "./stitch";
import { matchOsmStops, type ShapeIssue, validateShape } from "./validate";

/** 선로 데이터에 붙이는 출처 표기. 선로 모양은 OSM에서만 가져온다. */
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

const METERS_PER_KM = 1000;
const PIPE = /\|/g;
const ESCAPED_PIPE = String.raw`\|`;

export interface OsmRouteConfig {
	branchKey: string;
	/** up = 실시간 API updnLine=0(2호선 내선), down = 1(2호선 외선). */
	direction: TrackDirection;
	lineKey: LineKey;
	note?: string;
	osmRelationId: number;
}

export interface AssembleResult {
	issues: { osmRelationId: number; lineKey: LineKey; issues: ShapeIssue[] }[];
	/** crosswalk에 역이 있는데 shape가 하나도 만들어지지 않은 노선. */
	linesWithoutShape: LineKey[];
	markdown: string;
	ok: boolean;
	shapes: TrackShapeInput[];
	stitchFailures: { osmRelationId: number; reason: string }[];
	uncoveredStations: {
		statnId: string;
		lineKey: LineKey;
		nearestOffsetM: number;
	}[];
}

export interface AssembleInput {
	crosswalk: CrosswalkRow[];
	osm: OsmIndex;
	routes: OsmRouteConfig[];
}

type StitchFailure = Extract<StitchResult, { ok: false }>;

function describeStitchFailure(failure: StitchFailure): string {
	const where =
		failure.atWayId === undefined ? "" : ` at way ${failure.atWayId}`;
	const gap =
		failure.gapM === undefined ? "" : ` (${failure.gapM.toFixed(1)}m)`;
	return `${failure.reason}${where}${gap}`;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length === 0) {
		return 0;
	}
	if (sorted.length % 2 === 1) {
		return sorted[mid] ?? 0;
	}
	return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function adjacentGaps(onShape: PlacementResult["onShape"]): number[] {
	const gaps: number[] = [];
	for (let i = 1; i < onShape.length; i += 1) {
		const prev = onShape[i - 1];
		const cur = onShape[i];
		if (prev && cur) {
			gaps.push(cur.distanceM - prev.distanceM);
		}
	}
	return gaps;
}

function groupByLine(crosswalk: CrosswalkRow[]): Map<LineKey, CrosswalkRow[]> {
	const byLine = new Map<LineKey, CrosswalkRow[]>();
	for (const row of crosswalk) {
		const list = byLine.get(row.lineKey);
		if (list) {
			list.push(row);
		} else {
			byLine.set(row.lineKey, [row]);
		}
	}
	return byLine;
}

interface Coverage {
	covered: boolean;
	nearestOffsetM: number;
}

/** 역마다 자기 노선 shape 중 하나에 올라갔는지와 가장 가까운 offset을 누적한다. */
function recordCoverage(
	coverage: Map<string, Coverage>,
	placement: Pick<PlacementResult, "offShape" | "onShape">
): void {
	const visits = [
		...placement.onShape.map((s) => ({ ...s, on: true })),
		...placement.offShape.map((s) => ({ ...s, on: false })),
	];
	for (const { offsetM, on, statnId } of visits) {
		const prev = coverage.get(statnId);
		coverage.set(statnId, {
			covered: (prev?.covered ?? false) || on,
			nearestOffsetM: Math.min(prev?.nearestOffsetM ?? offsetM, offsetM),
		});
	}
}

function unmatchedStopIssues(
	stops: OsmNode[],
	matchedNodeIds: ReadonlySet<number>
): ShapeIssue[] {
	return stops
		.filter((stop) => !matchedNodeIds.has(stop.id))
		.map((stop) => ({
			code: "unmatched-osm-stop",
			detail: `node ${stop.id} ${stop.tags?.name ?? "(이름 없음)"}`,
			level: "warn",
		}));
}

/**
 * 닫힌 선(2호선 본선 같은 고리)이면 relation 순서상 첫 정차 노드(노선 역과 매칭되고 선 위에 있는 것)에서
 * 시작하도록 돌린다. 이음매가 첫 역 앞뒤에 걸려 첫 역이 끝으로 감기는 것을 막는다.
 */
function orientLoop(
	line: NodeLine,
	stops: OsmNode[],
	lineStations: CrosswalkRow[]
): NodeLine {
	if (!isClosed(line.coords, line.nodeIds)) {
		return line;
	}
	const matched = new Set(
		matchOsmStops(stops, lineStations).map((m) => m.osmNodeId)
	);
	const first = stops.find(
		(stop) => matched.has(stop.id) && line.nodeIds.includes(stop.id)
	);
	return first ? rotateToNode(line.coords, line.nodeIds, first.id) : line;
}

type ShapeOutcome =
	| { ok: true; issues: ShapeIssue[]; shape: TrackShapeInput }
	| { ok: false; reason: string };

function assembleRoute(
	route: OsmRouteConfig,
	osm: OsmIndex,
	lineStations: CrosswalkRow[],
	coverage: Map<string, Coverage>
): ShapeOutcome {
	const rel = osm.relations.get(route.osmRelationId);
	if (!rel) {
		return { ok: false, reason: "missing-relation" };
	}
	const stitched = stitchWays(wayMembersOf(rel, osm), osm);
	if (!stitched.ok) {
		return { ok: false, reason: describeStitchFailure(stitched) };
	}
	const stops = stopNodesOf(rel, osm);
	const line = orientLoop(stitched, stops, lineStations);
	const placement = placeStations({
		closed: isClosed(line.coords, line.nodeIds),
		coords: line.coords,
		nodeIds: line.nodeIds,
		stations: lineStations,
		stops,
	});
	recordCoverage(coverage, placement);

	const issues = [
		...validateShape({
			medianGapM: median(adjacentGaps(placement.onShape)),
			osmStopOrder: placement.stopOrder,
			stations: placement.onShape,
		}),
		...placement.issues,
		...unmatchedStopIssues(
			stops,
			new Set(placement.matches.map((m) => m.osmNodeId))
		),
	];
	return {
		issues,
		ok: true,
		shape: {
			attribution: OSM_ATTRIBUTION,
			branchKey: route.branchKey,
			coords: line.coords,
			direction: route.direction,
			lengthM: lineLengthM(line.coords),
			lineKey: route.lineKey,
			osmRelationId: route.osmRelationId,
			stations: placement.onShape.map((s, seq) => ({
				anchor: s.anchor,
				distanceM: s.distanceM,
				offsetM: s.offsetM,
				osmStopNodeId: s.osmStopNodeId,
				seq,
				statnId: s.statnId,
			})),
		},
	};
}

function lineOrder(lineKey: LineKey): number {
	return LINES.findIndex((line) => line.lineKey === lineKey);
}

/**
 * osm-routes.json의 relation마다 OSM way를 이어 선로 모양을 만들고,
 * 같은 노선의 crosswalk 역을 투영해 순서·OSM 정차 노드·검증 결과를 붙인다.
 * 실패한 relation은 stitchFailures에 남기고 다음 relation으로 넘어간다.
 */
export function assembleTracks({
	crosswalk,
	osm,
	routes,
}: AssembleInput): AssembleResult {
	const byLine = groupByLine(crosswalk);
	const coverage = new Map<string, Coverage>();
	const shapes: TrackShapeInput[] = [];
	const issues: AssembleResult["issues"] = [];
	const stitchFailures: AssembleResult["stitchFailures"] = [];

	for (const route of routes) {
		const outcome = assembleRoute(
			route,
			osm,
			byLine.get(route.lineKey) ?? [],
			coverage
		);
		if (!outcome.ok) {
			stitchFailures.push({
				osmRelationId: route.osmRelationId,
				reason: outcome.reason,
			});
			continue;
		}
		shapes.push(outcome.shape);
		if (outcome.issues.length > 0) {
			issues.push({
				issues: outcome.issues,
				lineKey: route.lineKey,
				osmRelationId: route.osmRelationId,
			});
		}
	}

	const uncoveredStations: AssembleResult["uncoveredStations"] = [];
	for (const row of crosswalk) {
		// coverage에 없는 역은 그 노선에 shape가 없는 경우다. linesWithoutShape로 드러난다.
		const seen = coverage.get(row.statnId);
		if (seen && !seen.covered) {
			uncoveredStations.push({
				lineKey: row.lineKey,
				nearestOffsetM: seen.nearestOffsetM,
				statnId: row.statnId,
			});
		}
	}
	const linesWithShape = new Set(shapes.map((s) => s.lineKey));
	const linesWithoutShape = [...byLine.keys()]
		.filter((lineKey) => !linesWithShape.has(lineKey))
		.sort((a, b) => lineOrder(a) - lineOrder(b));

	const hasError = issues.some((entry) =>
		entry.issues.some((issue) => issue.level === "error")
	);
	const ok =
		stitchFailures.length === 0 &&
		!hasError &&
		uncoveredStations.length === 0 &&
		linesWithoutShape.length === 0;
	const result = {
		issues,
		linesWithoutShape,
		ok,
		shapes,
		stitchFailures,
		uncoveredStations,
	};
	return { ...result, markdown: renderMarkdown(result, crosswalk) };
}

const cell = (value: string): string => value.replace(PIPE, ESCAPED_PIPE);

/** shape의 선 위 역을 배치 방식(anchor)별로 센다. */
export function anchorCounts(
	shape: Pick<TrackShapeInput, "stations">
): Record<TrackStationAnchor, number> {
	const counts: Record<TrackStationAnchor, number> = {
		"osm-stop": 0,
		"osm-stop-projected": 0,
		"station-master": 0,
	};
	for (const station of shape.stations) {
		counts[station.anchor] += 1;
	}
	return counts;
}

/** 모든 shape의 anchor 합계를 한 줄로 쓴다. */
export function renderAnchorTotals(shapes: TrackShapeInput[]): string {
	const totals = anchorCounts({ stations: shapes.flatMap((s) => s.stations) });
	return `osm-stop ${totals["osm-stop"]} / projected ${totals["osm-stop-projected"]} / master ${totals["station-master"]}`;
}

function renderLineCounts(
	shapes: TrackShapeInput[],
	crosswalk: CrosswalkRow[]
): string[] {
	const stationCount = groupByLine(crosswalk);
	return [
		"## 노선별 shape 수",
		"",
		"| lineKey | 노선 | shape 수 | crosswalk 역 수 |",
		"| --- | --- | --- | --- |",
		...LINES.map(
			(line) =>
				`| ${line.lineKey} | ${line.nameKo} | ${shapes.filter((s) => s.lineKey === line.lineKey).length} | ${stationCount.get(line.lineKey)?.length ?? 0} |`
		),
		"",
	];
}

function renderShapes(
	shapes: TrackShapeInput[],
	issues: AssembleResult["issues"]
): string[] {
	const byRelation = new Map(
		issues.map((entry) => [entry.osmRelationId, entry.issues])
	);
	return [
		"## shape",
		"",
		"| lineKey | branchKey | 방향 | relation | 길이(km) | 역 수 | osm-stop | projected | master | warn 수 | error 수 |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...shapes.map((s) => {
			const list = byRelation.get(s.osmRelationId) ?? [];
			const warns = list.filter((i) => i.level === "warn").length;
			const errors = list.length - warns;
			const anchors = anchorCounts(s);
			return `| ${s.lineKey} | ${cell(s.branchKey)} | ${s.direction} | ${s.osmRelationId} | ${(s.lengthM / METERS_PER_KM).toFixed(2)} | ${s.stations.length} | ${anchors["osm-stop"]} | ${anchors["osm-stop-projected"]} | ${anchors["station-master"]} | ${warns} | ${errors} |`;
		}),
		"",
	];
}

function renderIssueList(
	title: string,
	issues: AssembleResult["issues"],
	pick: (issue: ShapeIssue) => boolean
): string[] {
	const rows = issues.flatMap((entry) =>
		entry.issues
			.filter(pick)
			.map(
				(issue) =>
					`| ${entry.lineKey} | ${entry.osmRelationId} | ${issue.code} | ${cell(issue.detail)} |`
			)
	);
	if (rows.length === 0) {
		return [`## ${title}`, "", "없음", ""];
	}
	return [
		`## ${title} (${rows.length})`,
		"",
		"| lineKey | relation | code | detail |",
		"| --- | --- | --- | --- |",
		...rows,
		"",
	];
}

function renderList(title: string, rows: string[]): string[] {
	if (rows.length === 0) {
		return [`## ${title}`, "", "없음", ""];
	}
	return [`## ${title} (${rows.length})`, "", ...rows, ""];
}

function renderMarkdown(
	result: Omit<AssembleResult, "markdown">,
	crosswalk: CrosswalkRow[]
): string {
	const names = new Map(crosswalk.map((row) => [row.statnId, row]));
	return [
		"# 선로 조립 보고서",
		"",
		`ok: ${result.ok}`,
		`shape: ${result.shapes.length}, 선 위 역(중복 포함): ${result.shapes.reduce((sum, s) => sum + s.stations.length, 0)}`,
		`역 배치(anchor): ${renderAnchorTotals(result.shapes)}`,
		`출처: ${OSM_ATTRIBUTION}`,
		"",
		...renderLineCounts(result.shapes, crosswalk),
		...renderShapes(result.shapes, result.issues),
		...renderIssueList("error", result.issues, (i) => i.level === "error"),
		...renderList(
			"stitch 실패",
			result.stitchFailures.map(
				(f) => `- relation ${f.osmRelationId}: ${cell(f.reason)}`
			)
		),
		...renderList(
			"shape 없는 노선",
			result.linesWithoutShape.map((lineKey) => `- ${lineKey}`)
		),
		...renderList(
			"미커버 역",
			result.uncoveredStations.map(
				(s) =>
					`- ${s.lineKey} ${s.statnId} ${names.get(s.statnId)?.nameCanonical ?? ""} (가장 가까운 선로까지 ${s.nearestOffsetM.toFixed(1)}m)`
			)
		),
		...renderIssueList(
			"stop-anchor-rejected",
			result.issues,
			(i) => i.code === "stop-anchor-rejected"
		),
		...renderIssueList(
			"stop-ref-conflict",
			result.issues,
			(i) => i.code === "stop-ref-conflict"
		),
		...renderIssueList(
			"경고 (선로 투영)",
			result.issues,
			(i) =>
				i.level === "warn" &&
				i.code !== "unmatched-osm-stop" &&
				i.code !== "stop-anchor-rejected" &&
				i.code !== "stop-ref-conflict"
		),
		...renderIssueList(
			"OSM stop 미매칭",
			result.issues,
			(i) => i.code === "unmatched-osm-stop"
		),
	].join("\n");
}

import { createDb, type Database } from "@Betro/db";
import type { SourceManifest } from "@Betro/db/schema/transit";
import {
	isCurrentManifest,
	loadCurrentCrosswalk,
	loadTracks,
} from "../db/load";
import { isLineKey } from "../lines";
import osmRoutesJson from "../manual/osm-routes.json";
import { resolveDatabaseUrl } from "../paths";
import { readRaw, sha256Hex } from "../raw-store";
import { writeReport } from "../reports";
import {
	type AssembleInput,
	type AssembleResult,
	assembleTracks,
	type OsmRouteConfig,
} from "../track/assemble";
import { indexOsm } from "../track/osm-model";
import { osmRoutesSchema } from "./fetch-osm";

const JOB_NAME = "build-tracks";
const OSM_SOURCE = "osm";
const OSM_ROUTES_FILE = "routes.json";

export type BuildTracksInput = AssembleInput;

interface TrackSources {
	input: BuildTracksInput;
	manifest: SourceManifest;
}

const contentHash = (value: unknown): string =>
	sha256Hex(new TextEncoder().encode(JSON.stringify(value)));

/** osm-routes.json을 읽고 lineKey가 19개 노선 중 하나인지 확인한다. */
function readRouteConfig(): OsmRouteConfig[] {
	return osmRoutesSchema.parse(osmRoutesJson).map((route) => {
		const { lineKey } = route;
		if (!isLineKey(lineKey)) {
			throw new Error(
				`osm-routes.json relation ${route.osmRelationId}: unknown lineKey ${lineKey}`
			);
		}
		return { ...route, lineKey };
	});
}

async function readTrackSources(
	dataDir: string,
	db: Database
): Promise<TrackSources> {
	const raw = await readRaw(dataDir, OSM_SOURCE, OSM_ROUTES_FILE);
	if (!raw) {
		throw new Error(
			"OSM route 원본(data/raw/osm/routes.json)이 없습니다. 먼저 `bun transit fetch:osm`을 실행하세요."
		);
	}
	const crosswalk = await loadCurrentCrosswalk(db);
	if (crosswalk.length === 0) {
		throw new Error(
			"현재 station_crosswalk 배치가 없습니다. 먼저 `bun transit build:crosswalk`를 실행하세요."
		);
	}
	const routes = readRouteConfig();
	const osm = indexOsm(JSON.parse(new TextDecoder().decode(raw.bytes)));
	return {
		input: { crosswalk, osm, routes },
		manifest: {
			crosswalk: {
				fileName: `station_crosswalk current (${crosswalk.length})`,
				sha256: contentHash(crosswalk),
			},
			osmRouteConfig: {
				fileName: "manual/osm-routes.json",
				sha256: contentHash(routes),
			},
			osmRoutes: {
				fileName: `${OSM_SOURCE}/${OSM_ROUTES_FILE}`,
				sha256: raw.sha256,
			},
		},
	};
}

/** OSM 원본, osm-routes.json, DB의 현재 crosswalk 배치를 읽는다. db가 없으면 DATABASE_URL(기본 저장소 루트 local.db)로 연다. */
export async function loadBuildTracksInput(
	dataDir: string,
	db?: Database
): Promise<BuildTracksInput> {
	const database =
		db ?? createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) });
	return (await readTrackSources(dataDir, database)).input;
}

function summaryOf(
	result: AssembleResult,
	manifest: SourceManifest,
	dryRun: boolean
): Record<string, unknown> {
	return {
		dryRun,
		issues: result.issues,
		linesWithoutShape: result.linesWithoutShape,
		manifest,
		ok: result.ok,
		shapes: result.shapes.map((s) => ({
			branchKey: s.branchKey,
			direction: s.direction,
			lengthM: s.lengthM,
			lineKey: s.lineKey,
			osmRelationId: s.osmRelationId,
			stations: s.stations.length,
		})),
		stitchFailures: result.stitchFailures,
		uncoveredStations: result.uncoveredStations,
	};
}

export interface BuildTracksJobOptions {
	dataDir: string;
	/** 현재 crosswalk 배치를 읽는 데도 쓴다. 없으면 DATABASE_URL로 연다. */
	db?: Database;
	dryRun: boolean;
}

export interface BuildTracksJobResult {
	batchId?: number;
	jsonPath: string;
	mdPath: string;
	ok: boolean;
}

/**
 * OSM relation으로 선로 모양을 조립하고 보고서를 쓴다. ok이고 dryRun이 아니면 DB에 적재한다.
 * stitch 실패, error 수준 검증 결과, 미커버 역, shape 없는 노선이 하나라도 있으면 적재하지 않는다(ok=false).
 * 현재 track 배치와 원본 해시가 같으면 다시 적재하지 않는다.
 */
export async function buildTracks({
	dataDir,
	db,
	dryRun,
}: BuildTracksJobOptions): Promise<BuildTracksJobResult> {
	const database =
		db ?? createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) });
	const sources = await readTrackSources(dataDir, database);
	const result = assembleTracks(sources.input);
	const report = await writeReport(dataDir, JOB_NAME, {
		markdown: result.markdown,
		summary: summaryOf(result, sources.manifest, dryRun),
	});
	const errorCount = result.issues
		.flatMap((entry) => entry.issues)
		.filter((issue) => issue.level === "error").length;
	console.log(
		`ok: ${result.ok}\nshape: ${result.shapes.length}\nstitch 실패: ${result.stitchFailures.length}\nerror: ${errorCount}\n미커버 역: ${result.uncoveredStations.length}\nshape 없는 노선: ${result.linesWithoutShape.length}\nreport: ${report.mdPath}`
	);
	if (!result.ok) {
		console.error(
			"선로 검증 실패: DB에 적재하지 않습니다. 보고서를 보고 osm-routes.json을 고치세요."
		);
		return { ...report, ok: false };
	}
	if (dryRun) {
		console.log("dry-run: DB에 적재하지 않습니다.");
		return { ...report, ok: true };
	}
	if (await isCurrentManifest(database, "track", sources.manifest)) {
		console.log("원본 해시가 현재 배치와 같아 다시 적재하지 않습니다.");
		return { ...report, ok: true };
	}
	const { batchId } = await loadTracks(
		database,
		result.shapes,
		sources.manifest
	);
	const stationRows = result.shapes.reduce(
		(sum, s) => sum + s.stations.length,
		0
	);
	console.log(
		`batchId: ${batchId}\ntrack_shape: ${result.shapes.length}\ntrack_station: ${stationRows}`
	);
	return { ...report, batchId, ok: true };
}

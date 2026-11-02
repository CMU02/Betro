import { createDb, type Database } from "@Betro/db";
import type { SourceManifest } from "@Betro/db/schema/transit";
import {
	assembleBusRoutes,
	BUS_ROUTE_LOGIC_VERSION,
	type BusAssembleResult,
	type BusRouteRaw,
} from "../bus/assemble";
import { isCurrentManifest, loadBusRoutes, withLogicVersion } from "../db/load";
import { rawPath, resolveDatabaseUrl } from "../paths";
import { readRaw, sha256Hex } from "../raw-store";
import { writeReport } from "../reports";
import {
	BUS_ROUTE_XLSX_SOURCE,
	type BusRouteListEntry,
	parseBusRouteRows,
	readBusRouteXlsx,
} from "../sources/bus-route-xlsx";
import { latestBusRouteXlsx } from "./fetch-bus-route-xlsx";
import { BUS_PATH_SOURCE, BUS_STATIONS_SOURCE } from "./fetch-bus-routes";

const JOB_NAME = "build-bus-routes";

const textHash = (text: string): string =>
	sha256Hex(new TextEncoder().encode(text));

export interface BusRouteRawHash {
	pathSha?: string;
	routeId: string;
	stationsSha?: string;
}

/**
 * bus_route 적재 manifest: 노선 목록 엑셀, 노선별 원본 해시 묶음, 조립 로직 버전.
 * 노선 원본이 하나라도 바뀌면 routeRaw 해시가 달라진다. 입력 순서는 결과에 영향을 주지 않는다.
 */
export function busRouteManifest(
	routeList: { fileName: string; sha256: string },
	raws: readonly BusRouteRawHash[]
): SourceManifest {
	const joined = [...raws]
		.sort((a, b) =>
			a.routeId < b.routeId ? -1 : Number(a.routeId > b.routeId)
		)
		.map(
			(raw) => `${raw.routeId}:${raw.stationsSha ?? ""}:${raw.pathSha ?? ""}`
		)
		.join("\n");
	return withLogicVersion(
		{
			routeList,
			routeRaw: {
				fileName: `bus-route-stations+path (${raws.length} routes)`,
				sha256: textHash(joined),
			},
		},
		"busRouteLogicVersion",
		"bus route logic",
		BUS_ROUTE_LOGIC_VERSION
	);
}

async function readRouteList(dataDir: string): Promise<{
	routes: BusRouteListEntry[];
	routeList: { fileName: string; sha256: string };
}> {
	const latest = await latestBusRouteXlsx(dataDir);
	const raw = await readRaw(dataDir, BUS_ROUTE_XLSX_SOURCE, latest.fileName);
	if (!raw) {
		throw new Error(`bus route xlsx ${latest.fileName} disappeared`);
	}
	const rows = await readBusRouteXlsx(
		rawPath(dataDir, BUS_ROUTE_XLSX_SOURCE, latest.fileName)
	);
	const { routes, errors } = parseBusRouteRows(rows);
	if (errors.length > 0) {
		throw new Error(
			`bus route xlsx ${latest.fileName} invalid: ${errors.join("; ")}`
		);
	}
	return {
		routeList: {
			fileName: `${BUS_ROUTE_XLSX_SOURCE}/${latest.fileName}`,
			sha256: raw.sha256,
		},
		routes,
	};
}

async function readBodies(
	dataDir: string,
	entry: BusRouteListEntry
): Promise<{ hash: BusRouteRawHash; raw: BusRouteRaw }> {
	const name = `${entry.routeId}.json`;
	const [stations, path] = await Promise.all([
		readRaw(dataDir, BUS_STATIONS_SOURCE, name),
		readRaw(dataDir, BUS_PATH_SOURCE, name),
	]);
	const decoder = new TextDecoder();
	return {
		hash: {
			pathSha: path?.sha256,
			routeId: entry.routeId,
			stationsSha: stations?.sha256,
		},
		raw: {
			entry,
			pathBody: path ? decoder.decode(path.bytes) : undefined,
			stationsBody: stations ? decoder.decode(stations.bytes) : undefined,
		},
	};
}

/** 보고서 JSON 요약. markdown은 따로 쓰므로 뺀다. */
function summaryOf(
	{ markdown: _markdown, routes, ...rest }: BusAssembleResult,
	manifest: SourceManifest,
	dryRun: boolean
) {
	return {
		...rest,
		dryRun,
		loaded: routes.length,
		manifest,
		routes: routes.map((route) => ({
			lengthM: route.lengthM,
			qualityFlags: route.qualityFlags,
			routeId: route.routeId,
			routeName: route.routeName,
			routeType: route.routeType,
			segments: route.segments.length,
			stops: route.stops.length,
		})),
	};
}

export interface BuildBusRoutesOptions {
	dataDir: string;
	/** 없으면 DATABASE_URL로 연다. */
	db?: Database;
	dryRun: boolean;
	/** 있으면 엑셀을 읽지 않고 이 목록을 쓴다(테스트용). */
	routes?: BusRouteListEntry[];
}

export interface BuildBusRoutesResult {
	batchId?: number;
	jsonPath: string;
	mdPath: string;
	ok: boolean;
}

/**
 * 받아 둔 노선 원본을 조립·검증하고 보고서를 쓴다. ok이고 dryRun이 아니면 DB에 적재한다.
 * 수집이 덜 끝났거나(원본 없음) 적재 가능한 노선 비율이 모자라면 적재하지 않는다(ok=false).
 * 현재 bus_route 배치와 manifest가 같으면 다시 적재하지 않는다.
 */
export async function buildBusRoutes({
	dataDir,
	db,
	dryRun,
	routes: routesOption,
}: BuildBusRoutesOptions): Promise<BuildBusRoutesResult> {
	const database =
		db ?? createDb({ DATABASE_URL: resolveDatabaseUrl(process.env) });
	const source = routesOption
		? {
				routeList: {
					fileName: `routes option (${routesOption.length})`,
					sha256: textHash(JSON.stringify(routesOption)),
				},
				routes: routesOption,
			}
		: await readRouteList(dataDir);
	const loaded = await Promise.all(
		source.routes.map((entry) => readBodies(dataDir, entry))
	);
	const result = assembleBusRoutes(loaded.map(({ raw }) => raw));
	const manifest = busRouteManifest(
		source.routeList,
		loaded.map(({ hash }) => hash)
	);
	const report = await writeReport(dataDir, JOB_NAME, {
		markdown: result.markdown,
		summary: summaryOf(result, manifest, dryRun),
	});
	console.log(
		`ok: ${result.ok}\n적재 대상 노선: ${result.routes.length}\n제외 노선: ${result.excluded.length}\n원본 없음: ${result.missingRaw.length}\n범위 밖: ${result.outOfScope}\nreport: ${report.mdPath}`
	);
	if (!result.ok) {
		console.error(
			"버스 노선 검증 실패: DB에 적재하지 않습니다. 보고서를 보고 수집(fetch:bus-routes)을 이어가거나 원본을 확인하세요."
		);
		return { ...report, ok: false };
	}
	if (dryRun) {
		console.log("dry-run: DB에 적재하지 않습니다.");
		return { ...report, ok: true };
	}
	if (await isCurrentManifest(database, "bus_route", manifest)) {
		console.log("원본 해시가 현재 배치와 같아 다시 적재하지 않습니다.");
		return { ...report, ok: true };
	}
	const { batchId } = await loadBusRoutes(database, result.routes, manifest);
	console.log(`batchId: ${batchId}\nbus_route: ${result.routes.length}`);
	return { ...report, batchId, ok: true };
}

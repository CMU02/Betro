import { createDb, type Database } from "@Betro/db";
import type { SourceManifest } from "@Betro/db/schema/transit";
import { readdir } from "node:fs/promises";
import {
	type AssembledBusRoute,
	assembleBusRoutes,
	BUS_ROUTE_LOGIC_VERSION,
	type BusAssembleResult,
	type BusRouteRaw,
	busShapeAttribution,
} from "../bus/assemble";
import {
	assembleRegionalSource,
	type RegionalRouteRaw,
	type RegionalSourceResult,
} from "../bus/regional";
import { type RegionalReportInput, renderRegionalReport } from "../bus/report";
import {
	type BusRouteEntry,
	isInScopeRegionalRoute,
	type RegionalBusSource,
	withRegionalRoutes,
} from "../bus/scope";
import { compareCodeUnits } from "../compare";
import { isCurrentManifest, loadBusRoutes, withLogicVersion } from "../db/load";
import { rawPath, resolveDatabaseUrl } from "../paths";
import { readRaw, sha256Hex } from "../raw-store";
import { writeReport } from "../reports";
import { BUS_ROUTE_XLSX_SOURCE } from "../sources/bus-route-xlsx";
import type { RegionalRouteRow } from "../sources/regional-bus-types";
import { BUS_ROUTE_LIST_SOURCE } from "./fetch-bus-route-list";
import {
	BUS_PATH_SOURCE,
	BUS_STATIONS_SOURCE,
	loadXlsxRoutes,
	requireRouteList,
} from "./fetch-bus-routes";
import {
	isSafeRegionalRouteId,
	REGIONAL_ROUTES_FILE,
	regionalRawSource,
} from "./fetch-regional-bus";

const JOB_NAME = "build-bus-routes";
const REGIONAL_SOURCES: readonly RegionalBusSource[] = ["gbis", "tago"];
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

const textHash = (text: string): string =>
	sha256Hex(new TextEncoder().encode(text));

export interface BusRouteRawHash {
	pathSha?: string;
	routeId: string;
	stationsSha?: string;
}

/**
 * bus_route 적재 manifest: 노선 목록 엑셀, 노선별 원본 해시 묶음, 조립 로직 버전, 그 밖의 출처(extra, 예: 경기·인천 노선 목록).
 * 노선 원본이 하나라도 바뀌면 routeRaw 해시가 달라진다. 입력 순서는 결과에 영향을 주지 않는다.
 */
export function busRouteManifest(
	routeList: { fileName: string; sha256: string },
	raws: readonly BusRouteRawHash[],
	extra: SourceManifest = {}
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
			...extra,
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

interface RouteSource {
	/** manifest에 더하는 출처(노선 목록). */
	extra: SourceManifest;
	routeList: { fileName: string; sha256: string };
	routes: BusRouteEntry[];
}

/** 노선 ID 출처: 엑셀의 노선 ∪ 최근 노선 목록(getBusRouteList)에서 routeType 7·8인 노선. 목록이 없으면 멈춘다. */
async function readRouteList(dataDir: string): Promise<RouteSource> {
	const list = requireRouteList(dataDir);
	const xlsx = await loadXlsxRoutes(dataDir);
	const raw = await readRaw(dataDir, BUS_ROUTE_XLSX_SOURCE, xlsx.fileName);
	if (!raw) {
		throw new Error(`bus route xlsx ${xlsx.fileName} disappeared`);
	}
	return {
		extra: {
			// 목록의 shortName과 경기·인천 노선 집합이 적재 결과에 들어가므로 목록 내용으로 해시한다.
			regionalRouteList: {
				fileName: `${BUS_ROUTE_LIST_SOURCE}/routes.json (${list.length} routes)`,
				sha256: textHash(JSON.stringify(list)),
			},
		},
		routeList: {
			fileName: `${BUS_ROUTE_XLSX_SOURCE}/${xlsx.fileName}`,
			sha256: raw.sha256,
		},
		routes: withRegionalRoutes(xlsx.routes, list),
	};
}

async function readBodies(
	dataDir: string,
	entry: BusRouteEntry
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

interface RegionalList {
	/** manifest에 쓰는 이름(`<source>-route-list/routes.json`). 날짜 폴더는 넣지 않는다. */
	fileName: string;
	rows: RegionalRouteRow[];
	text: string;
}

/** 가장 최근 날짜 폴더의 합친 목록(routes.json). 받은 적이 없으면 null. */
async function latestRegionalList(
	dataDir: string,
	source: RegionalBusSource
): Promise<RegionalList | null> {
	const listSource = regionalRawSource(source, "list");
	let dirs: string[];
	try {
		dirs = await readdir(rawPath(dataDir, listSource, ""));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
	const newestFirst = dirs
		.filter((dir) => DATE_DIR_RE.test(dir))
		// 날짜 폴더 이름(ASCII)을 코드 단위 순서로 정렬한다. 로캘에 따라 달라지지 않게 한다.
		.sort(compareCodeUnits)
		.reverse();
	for (const dir of newestFirst) {
		const fileName = `${dir}/${REGIONAL_ROUTES_FILE}`;
		// biome-ignore lint/performance/noAwaitInLoops: 가장 최근 폴더부터 하나씩 확인한다
		const raw = await readRaw(dataDir, listSource, fileName);
		if (raw) {
			const text = new TextDecoder().decode(raw.bytes);
			return {
				// 날짜는 이름에 넣지 않는다. 같은 내용을 다른 날 다시 받아도 manifest가 같게 한다.
				fileName: `${listSource}/${REGIONAL_ROUTES_FILE}`,
				rows: JSON.parse(text) as RegionalRouteRow[],
				text,
			};
		}
	}
	return null;
}

interface RegionalRead {
	list: RegionalList | null;
	/** 범위 안 노선의 원본 해시. manifest에 들어간다. */
	rawHashes: string[];
	raws: Map<string, RegionalRouteRaw>;
	source: RegionalBusSource;
}

/** 한 출처의 목록과, 범위 안 노선마다 저장된 노선 정보·경유 정류장 원본을 읽는다. */
async function readRegionalSource(
	dataDir: string,
	source: RegionalBusSource
): Promise<RegionalRead> {
	const list = await latestRegionalList(dataDir, source);
	const raws = new Map<string, RegionalRouteRaw>();
	const rawHashes: string[] = [];
	if (!list) {
		return { list, rawHashes, raws, source };
	}
	// 수집 job과 같은 규칙으로 받은 노선만 읽는다. 파일 이름으로 못 쓰는 ID는 원본 없음으로 남는다.
	const targets = list.rows.filter(
		(row) =>
			isInScopeRegionalRoute(source, row.routeTypeCode) &&
			isSafeRegionalRouteId(row.routeId)
	);
	const decoder = new TextDecoder();
	const read = await Promise.all(
		targets.map(async ({ routeId }) => {
			const name = `${routeId}.json`;
			const [info, stations] = await Promise.all([
				readRaw(dataDir, regionalRawSource(source, "info"), name),
				readRaw(dataDir, regionalRawSource(source, "stations"), name),
			]);
			return { info, routeId, stations };
		})
	);
	for (const { info, routeId, stations } of read) {
		raws.set(routeId, {
			infoBody: info ? decoder.decode(info.bytes) : undefined,
			stationsBody: stations ? decoder.decode(stations.bytes) : undefined,
		});
		rawHashes.push(
			`${routeId}:${info?.sha256 ?? ""}:${stations?.sha256 ?? ""}`
		);
	}
	return { list, rawHashes, raws, source };
}

/**
 * manifest의 `gbisRouteList`·`tagoRouteList`. 목록 내용과 노선별 원본 해시를 함께 해시해,
 * 남은 원본을 이어 받으면 manifest가 달라져 다시 적재되게 한다. 목록이 없는 출처는 넣지 않는다.
 */
function regionalManifest(reads: readonly RegionalRead[]): SourceManifest {
	const manifest: SourceManifest = {};
	for (const { list, rawHashes, source } of reads) {
		if (!list) {
			continue;
		}
		// 해시(16진수)를 코드 단위 순서로 이어 붙여 배치 manifest가 늘 같게 한다.
		const joined = [list.text, ...[...rawHashes].sort(compareCodeUnits)].join(
			"\n"
		);
		manifest[`${source}RouteList`] = {
			fileName: `${list.fileName} (${list.rows.length} routes, ${rawHashes.length} raws)`,
			sha256: textHash(joined),
		};
	}
	return manifest;
}

function assembleRegional(
	reads: readonly RegionalRead[],
	seoulRouteIds: ReadonlySet<string>
): { report: RegionalReportInput[]; results: RegionalSourceResult[] } {
	const results = reads.map(({ list, raws, source }) =>
		assembleRegionalSource({
			raws,
			routes: list?.rows ?? [],
			seoulRouteIds,
			source,
		})
	);
	const report = results.map(({ routes: _routes, ...rest }, i) => ({
		...rest,
		attribution: busShapeAttribution(rest.source),
		listed: reads[i]?.list?.rows.length ?? null,
	}));
	return { report, results };
}

/** 보고서 JSON 요약. markdown은 따로 쓰므로 뺀다. */
function summaryOf(
	{ markdown: _markdown, routes: _seoulRoutes, ...rest }: BusAssembleResult,
	{
		ok,
		regional,
		routes,
	}: {
		ok: boolean;
		regional: readonly RegionalReportInput[];
		routes: readonly AssembledBusRoute[];
	},
	manifest: SourceManifest,
	dryRun: boolean
) {
	return {
		...rest,
		dryRun,
		loaded: routes.length,
		manifest,
		ok,
		regional: Object.fromEntries(regional.map((item) => [item.source, item])),
		routes: routes.map((route) => ({
			areaName: route.areaName ?? null,
			lengthM: route.lengthM,
			qualityFlags: route.qualityFlags,
			region: route.region,
			routeId: route.routeId,
			routeName: route.routeName,
			routeType: route.routeType,
			segments: route.segments.length,
			shortName: route.shortName,
			source: route.source ?? "seoul",
			stops: route.stops.length,
		})),
	};
}

export interface BuildBusRoutesOptions {
	dataDir: string;
	/** 없으면 DATABASE_URL로 연다. */
	db?: Database;
	dryRun: boolean;
	/** 있으면 엑셀과 노선 목록을 읽지 않고 이 목록을 쓴다(테스트용). */
	routes?: BusRouteEntry[];
}

export interface BuildBusRoutesResult {
	batchId?: number;
	jsonPath: string;
	mdPath: string;
	ok: boolean;
}

/**
 * 받아 둔 노선 원본을 조립·검증하고 보고서를 쓴다. ok이고 dryRun이 아니면 DB에 적재한다.
 * 서울 API 노선에 경기(GBIS)·인천(TAGO) 정적 노선을 붙인다. 목록을 받지 않은 출처는 건너뛴다.
 * 수집이 덜 끝났거나(원본 없음) 적재 가능한 노선 비율이 모자라면 적재하지 않는다(ok=false).
 * GBIS·TAGO는 출처마다 regionalMinLoadableRatio로 본다.
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
	const source: RouteSource = routesOption
		? {
				extra: {},
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
	const reads = await Promise.all(
		REGIONAL_SOURCES.map((regionalSource) =>
			readRegionalSource(dataDir, regionalSource)
		)
	);
	// 서울 노선 목록(엑셀 ∪ 7·8)에 있는 노선은 서울 쪽이 이긴다(계획 설계 판단 2, 실험 1절 5-A 확인).
	// 서울 조립에서 빠진 노선(route-not-found, shape-too-short)도 목록에 있으면 서울 노선이다.
	// 적재된 서울 행으로만 보면 배치마다 출처가 바뀌어 저장된 `gbis:`·`tago:` 참조가 끊긴다.
	const regional = assembleRegional(
		reads,
		new Set(source.routes.map((entry) => entry.routeId))
	);
	const routes = [
		...result.routes,
		...regional.results.flatMap((item) => item.routes),
	];
	const ok = result.ok && regional.results.every((item) => item.ok);
	const manifest = busRouteManifest(
		source.routeList,
		loaded.map(({ hash }) => hash),
		{ ...source.extra, ...regionalManifest(reads) }
	);
	const report = await writeReport(dataDir, JOB_NAME, {
		markdown: [result.markdown, ...renderRegionalReport(regional.report)].join(
			"\n"
		),
		summary: summaryOf(
			result,
			{ ok, regional: regional.report, routes },
			manifest,
			dryRun
		),
	});
	const regionalLines = regional.report.map((item) =>
		item.listed === null
			? `적재 가능(${item.source}): 목록 없음`
			: `적재 가능(${item.source}): ${item.loadable}/${item.inScope} (서울과 겹침 ${item.duplicates}, 원본 없음 ${item.missingRaw.length})`
	);
	console.log(
		[
			`ok: ${ok}`,
			`적재 대상 노선: ${routes.length}`,
			`제외 노선: ${result.excluded.length}`,
			`원본 없음: ${result.missingRaw.length}`,
			`범위 밖: ${result.outOfScope}`,
			`적재 가능(서울): ${result.loadable.seoul.loadable}/${result.loadable.seoul.inScope}`,
			`적재 가능(경기·인천): ${result.loadable.regional.loadable}/${result.loadable.regional.inScope}`,
			...regionalLines,
			`report: ${report.mdPath}`,
		].join("\n")
	);
	if (!ok) {
		console.error(
			"버스 노선 검증 실패: DB에 적재하지 않습니다. 보고서를 보고 수집(fetch:bus-routes, fetch:gbis-routes, fetch:tago-routes)을 이어가거나 원본을 확인하세요."
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
	const { batchId } = await loadBusRoutes(database, routes, manifest);
	console.log(`batchId: ${batchId}\nbus_route: ${routes.length}`);
	return { ...report, batchId, ok: true };
}

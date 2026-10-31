import type { Database } from "@Betro/db";
import type { SourceManifest } from "@Betro/db/schema/transit";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type BuildCrosswalkInput,
	type BuildCrosswalkResult,
	buildCrosswalk as computeCrosswalk,
	countByMatchMethod,
} from "../crosswalk/build";
import type { StationAlias } from "../crosswalk/match";
import { manualTable } from "../crosswalk/source-line-names";
import { isCurrentManifest, loadCrosswalk } from "../db/load";
import stationAliasesJson from "../manual/station-aliases.json" with {
	type: "json",
};
import { rawPath } from "../paths";
import { readRaw, sha256Hex } from "../raw-store";
import { writeReport } from "../reports";
import {
	normalizeStationMasterRows,
	normalizeStationSearchRows,
	type StationSearchRow,
} from "../sources/seoul-open-api";
import {
	parseStationRows,
	type RealtimeStationRow,
	readStationXlsx,
} from "../sources/station-xlsx";

const JOB_NAME = "build-crosswalk";
const XLSX_SOURCE = "oa-12764-station-xlsx";
const XLSX_NAME = /^stations-seq(\d+)\.xlsx$/;
const MASTER_SOURCE = "oa-21232-station-master";
const MASTER_FILE = "station-master.json";
const SEARCH_SOURCE = "oa-121-station-search";
const SEARCH_FILE = /\.json$/;
/** 빠진 역 검색 결과를 오류 메시지에 몇 개까지 보여줄지. */
const MISSING_NAME_PREVIEW = 5;

const stationAliases: StationAlias[] = stationAliasesJson;

interface CrosswalkSources {
	input: BuildCrosswalkInput;
	manifest: SourceManifest;
	prevXlsxName?: string;
}

function runFirst(what: string, command: string): Error {
	return new Error(
		`${what}이(가) 없습니다. 먼저 \`bun transit ${command}\`를 실행하세요.`
	);
}

async function listDir(dir: string): Promise<string[] | undefined> {
	try {
		return await readdir(dir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

/** xlsx 판을 seq 내림차순으로 돌려준다. */
async function listXlsxEditions(dataDir: string): Promise<string[]> {
	const names = (await listDir(join(dataDir, "raw", XLSX_SOURCE))) ?? [];
	return names
		.map((name) => XLSX_NAME.exec(name))
		.filter((match): match is RegExpExecArray => match !== null)
		.sort((a, b) => Number(b[1]) - Number(a[1]))
		.map((match) => match[0]);
}

async function readXlsxStations(
	dataDir: string,
	fileName: string
): Promise<RealtimeStationRow[]> {
	const parsed = parseStationRows(
		await readStationXlsx(rawPath(dataDir, XLSX_SOURCE, fileName))
	);
	if (parsed.errors.length > 0) {
		throw new Error(
			`${fileName} 파싱 오류 ${parsed.errors.length}건:\n${parsed.errors.join("\n")}`
		);
	}
	return parsed.rows;
}

function parseRowsEnvelope(bytes: Uint8Array, label: string): unknown[] {
	const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
	const rows =
		typeof json === "object" && json !== null
			? (json as { rows?: unknown }).rows
			: undefined;
	if (!Array.isArray(rows)) {
		throw new Error(`${label}에 rows 배열이 없습니다.`);
	}
	return rows;
}

async function readSearchResults(
	dataDir: string,
	names: string[]
): Promise<{ searchByName: Map<string, StationSearchRow[]>; sha256: string }> {
	const results = await Promise.all(
		names.map(async (name) => ({
			name,
			raw: await readRaw(dataDir, SEARCH_SOURCE, `${name}.json`),
		}))
	);
	const missing = results.filter((r) => r.raw === undefined).map((r) => r.name);
	if (missing.length > 0) {
		const preview = missing.slice(0, MISSING_NAME_PREVIEW).join(", ");
		throw new Error(
			`역 검색(OA-121) 결과 ${missing.length}개가 없습니다(예: ${preview}). \`bun transit fetch:station-search\`를 다시 실행하면 빠진 것만 이어서 받습니다.`
		);
	}
	const searchByName = new Map<string, StationSearchRow[]>();
	const digest: string[] = [];
	for (const { name, raw } of results) {
		if (!raw) {
			continue;
		}
		const rows = parseRowsEnvelope(raw.bytes, `${SEARCH_SOURCE}/${name}.json`);
		searchByName.set(
			name,
			normalizeStationSearchRows(rows as Record<string, unknown>[])
		);
		digest.push(`${name}\t${raw.sha256}`);
	}
	digest.sort();
	return {
		searchByName,
		sha256: sha256Hex(new TextEncoder().encode(digest.join("\n"))),
	};
}

function contentHash(value: unknown): string {
	return sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * 원본 파일을 읽어 대응표 입력과 원본 해시 manifest를 만든다.
 * 원본이 없으면 먼저 돌릴 fetch 명령을 알려주는 오류를 던진다.
 */
async function readCrosswalkSources(
	dataDir: string
): Promise<CrosswalkSources> {
	const [latestXlsx, prevXlsx] = await listXlsxEditions(dataDir);
	if (!latestXlsx) {
		throw runFirst("실시간도착_역정보 xlsx(OA-12764)", "fetch:station-xlsx");
	}
	const master = await readRaw(dataDir, MASTER_SOURCE, MASTER_FILE);
	if (!master) {
		throw runFirst("역사마스터(OA-21232) 원본", "fetch:station-master");
	}
	const searchFiles =
		(await listDir(join(dataDir, "raw", SEARCH_SOURCE))) ?? [];
	if (!searchFiles.some((name) => SEARCH_FILE.test(name))) {
		throw runFirst("역 검색(OA-121) 원본", "fetch:station-search");
	}

	const xlsxRaw = await readRaw(dataDir, XLSX_SOURCE, latestXlsx);
	if (!xlsxRaw) {
		throw runFirst(latestXlsx, "fetch:station-xlsx");
	}
	const stations = await readXlsxStations(dataDir, latestXlsx);
	const prevStations = prevXlsx
		? await readXlsxStations(dataDir, prevXlsx)
		: undefined;
	const masterRows = normalizeStationMasterRows(
		parseRowsEnvelope(master.bytes, MASTER_FILE) as Record<string, unknown>[]
	);
	if (!masterRows.ok) {
		throw new Error(
			`${MASTER_FILE} 정규화 실패: ${masterRows.code} ${masterRows.message}`
		);
	}
	const names = [...new Set(stations.map((s) => s.nameRaw))].filter(
		(name) => name !== ""
	);
	const search = await readSearchResults(dataDir, names);

	return {
		input: {
			aliases: stationAliases,
			lineNames: manualTable,
			master: masterRows.rows,
			prevStations,
			searchByName: search.searchByName,
			stations,
		},
		manifest: {
			sourceLineNames: {
				fileName: "manual/source-line-names.json",
				sha256: contentHash(manualTable),
			},
			stationAliases: {
				fileName: "manual/station-aliases.json",
				sha256: contentHash(stationAliases),
			},
			stationMaster: { fileName: MASTER_FILE, sha256: master.sha256 },
			stationSearch: {
				fileName: `${SEARCH_SOURCE}/*.json (${names.length})`,
				sha256: search.sha256,
			},
			xlsx: { fileName: latestXlsx, sha256: xlsxRaw.sha256 },
		},
		prevXlsxName: prevXlsx,
	};
}

export async function loadBuildCrosswalkInput(
	dataDir: string
): Promise<BuildCrosswalkInput> {
	return (await readCrosswalkSources(dataDir)).input;
}

function manifestSection(
	manifest: SourceManifest,
	prevXlsxName: string | undefined
): string {
	const lines = [
		"",
		"## 원본 manifest",
		"",
		"| 키 | 파일 | sha256 |",
		"|---|---|---|",
		...Object.entries(manifest).map(
			([key, entry]) => `| ${key} | ${entry.fileName} | ${entry.sha256} |`
		),
		"",
		`이전 판(비교 대상): ${prevXlsxName ?? "없음"}`,
		"",
	];
	return lines.join("\n");
}

function summaryOf(
	result: BuildCrosswalkResult,
	sources: CrosswalkSources,
	dryRun: boolean
): Record<string, unknown> {
	return {
		byMethod: countByMatchMethod(result.rows),
		diff: result.diff
			? {
					added: result.diff.added.map((s) => s.statnId),
					removed: result.diff.removed.map((s) => s.statnId),
					renamed: result.diff.renamed,
				}
			: null,
		dryRun,
		lineCount: new Set(result.rows.map((row) => row.lineKey)).size,
		manifest: sources.manifest,
		matched: result.rows.length,
		missingCodes: result.missingCodes,
		ok: result.ok,
		prevXlsx: sources.prevXlsxName ?? null,
		total: sources.input.stations.length,
		unmappedLineNums: result.unmappedLineNums,
		unmappedRoutes: result.unmappedRoutes,
		unmatched: result.unmatched.map((s) => ({
			lineKey: s.lineKey,
			nameRaw: s.nameRaw,
			statnId: s.statnId,
		})),
	};
}

export interface BuildCrosswalkJobOptions {
	dataDir: string;
	/** dryRun이 아니면 필요하다. */
	db?: Database;
	dryRun: boolean;
}

export interface BuildCrosswalkJobResult {
	batchId?: number;
	jsonPath: string;
	mdPath: string;
	ok: boolean;
}

/**
 * 원본으로 대응표를 만들고 보고서를 쓴다. ok이고 dryRun이 아니면 DB에 적재한다.
 * 매칭 안 된 역이나 매핑 안 된 노선 문자열이 하나라도 있으면 적재하지 않는다(ok=false).
 * 현재 배치와 원본 해시가 같으면 다시 적재하지 않는다.
 */
export async function buildCrosswalk({
	dataDir,
	db,
	dryRun,
}: BuildCrosswalkJobOptions): Promise<BuildCrosswalkJobResult> {
	const sources = await readCrosswalkSources(dataDir);
	const result = computeCrosswalk(sources.input);
	const report = await writeReport(dataDir, JOB_NAME, {
		markdown: `${result.markdown}${manifestSection(sources.manifest, sources.prevXlsxName)}`,
		summary: summaryOf(result, sources, dryRun),
	});
	console.log(
		`ok: ${result.ok}\n매칭 ${result.rows.length} / ${sources.input.stations.length}\n미매칭: ${result.unmatched.length}\n매핑 안 된 ROUTE: ${result.unmappedRoutes.length}\n매핑 안 된 LINE_NUM: ${result.unmappedLineNums.length}\n코드 없는 역: ${result.missingCodes.length}\nreport: ${report.mdPath}`
	);
	if (!result.ok) {
		console.error(
			"대응표 검증 실패: DB에 적재하지 않습니다. 보고서를 보고 매뉴얼 표를 고치세요."
		);
		return { ...report, ok: false };
	}
	if (dryRun) {
		console.log("dry-run: DB에 적재하지 않습니다.");
		return { ...report, ok: true };
	}
	if (!db) {
		throw new Error("buildCrosswalk: dryRun이 아니면 db가 필요합니다.");
	}
	if (await isCurrentManifest(db, "station_crosswalk", sources.manifest)) {
		console.log("원본 해시가 현재 배치와 같아 다시 적재하지 않습니다.");
		return { ...report, ok: true };
	}
	const { batchId } = await loadCrosswalk(db, result.rows, sources.manifest);
	console.log(`batchId: ${batchId}\nrows: ${result.rows.length}`);
	return { ...report, batchId, ok: true };
}

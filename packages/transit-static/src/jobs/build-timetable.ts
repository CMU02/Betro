import type { Database } from "@Betro/db";
import type {
	ServiceDay,
	SourceManifest,
	TimetableSourceKind,
} from "@Betro/db/schema/transit";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
	isCurrentManifest,
	loadCurrentCrosswalk,
	loadTimetable,
	withLogicVersion,
} from "../db/load";
import { isLineKey, LINES, type LineKey } from "../lines";
import timetableSourcesJson from "../manual/timetable-sources.json" with {
	type: "json",
};
import timetableAliasesJson from "../manual/timetable-station-aliases.json" with {
	type: "json",
};
import { readRaw, sha256Hex } from "../raw-store";
import { writeReport } from "../reports";
import { parseAirportExpressCsv } from "../sources/airport-express-csv";
import { parseKorailXlsx } from "../sources/korail-xlsx";
import { readKricServiceKey } from "../sources/kric-api";
import {
	KRIC_RAW_SOURCE,
	type KricRow,
	readKricRows,
} from "../sources/kric-file";
import { parseKricKorailRows } from "../sources/kric-korail-rows";
import { KRIC_PACKED_LINES, parseKricPacked } from "../sources/kric-packed";
import {
	decodeCp949,
	parseSeoulMetroCsv,
	SEOUL_METRO_RAW_SOURCE,
	seoulMetroSourceVersion,
} from "../sources/seoul-metro-csv";
import { normalizeTripTimes, parseClock } from "../timetable/clock";
import type { SourceTrip, StopTime, Trip } from "../timetable/model";
import {
	parseTimetableSourcesConfig,
	type ResolvedLineSources,
	resolveSources,
} from "../timetable/registry";
import { type LineReport, renderTimetableReport } from "../timetable/report";
import {
	createStationResolver,
	type StationAlias,
	type StationResolver,
	type UnresolvedStation,
} from "../timetable/resolve-station";
import { type TimetableIssue, validateTrips } from "../timetable/validate";

const JOB_NAME = "build-timetable";
/** 시간표 변환·검증 로직 버전. 바꾸면 원본이 같아도 다시 적재된다(manifest 키 timetableVersion). */
export const TIMETABLE_LOGIC_VERSION = 1;
const UNKNOWN_VERSION = "unknown";
/** 공항철도 직통 CSV에는 요일 열이 없다. 직통 시각표가 요일과 무관하다고 보고 세 요일에 모두 넣는다. */
const AIRPORT_EXPRESS_SERVICE_DAYS: readonly ServiceDay[] = [
	"weekday",
	"saturday",
	"holiday",
];
const FETCH_HINT = "먼저 `bun transit fetch:timetable-sources`를 실행하세요.";

/** timetable 적재 manifest: 원본 해시에 시간표 로직 버전(timetableVersion)을 더한다. */
export function timetableManifest(
	sources: SourceManifest,
	version: number = TIMETABLE_LOGIC_VERSION
): SourceManifest {
	return withLogicVersion(
		sources,
		"timetableVersion",
		"timetable logic",
		version
	);
}

const contentHash = (value: unknown): string =>
	sha256Hex(new TextEncoder().encode(JSON.stringify(value)));

const aliasesSchema = z.array(
	z.object({
		lineKey: z.string().refine(isLineKey, "unknown lineKey"),
		source: z.enum([
			"*",
			"seoul-metro-csv",
			"kric-korail",
			"kric-packed",
			"korail-xlsx",
			"airport-express-csv",
			"kric-api",
		]),
		sourceStation: z.string().min(1),
		statnId: z.string().min(1),
	})
);

function readAliases(): StationAlias[] {
	return aliasesSchema
		.parse(timetableAliasesJson)
		.map((alias) => ({ ...alias, lineKey: alias.lineKey as LineKey }));
}

/** 한 출처를 읽은 결과. 원본이 없으면 missing에 이유를 둔다. */
interface SourceLoad {
	errors: string[];
	manifest: SourceManifest;
	missing?: string;
	trips: SourceTrip[];
	/** trip에 기준일이 없을 때 쓸 노선별 출처 기준일 */
	versionFor: (lineKey: LineKey) => string;
}

const missingLoad = (missing: string): SourceLoad => ({
	errors: [],
	manifest: {},
	missing,
	trips: [],
	versionFor: () => UNKNOWN_VERSION,
});

interface RawFile {
	bytes: Uint8Array;
	fileName: string;
	sha256: string;
}

/** data/raw/<source>/의 파일 중 이름순으로 마지막 파일(파일명의 기준일이 가장 늦은 판). 없으면 undefined. */
async function latestRaw(
	dataDir: string,
	source: string
): Promise<RawFile | undefined> {
	let names: string[];
	try {
		const entries = await readdir(join(dataDir, "raw", source), {
			withFileTypes: true,
		});
		names = entries.filter((e) => e.isFile()).map((e) => e.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
	const fileName = names.sort().at(-1);
	if (!fileName) {
		return undefined;
	}
	const raw = await readRaw(dataDir, source, fileName);
	return raw ? { fileName, ...raw } : undefined;
}

function manualDir(dataDir: string): string {
	return join(dataDir, "manual", "timetables");
}

async function listManualFiles(dataDir: string): Promise<string[]> {
	try {
		const entries = await readdir(manualDir(dataDir), { withFileTypes: true });
		return entries.filter((e) => e.isFile()).map((e) => e.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function readManual(dataDir: string, fileName: string): Promise<RawFile> {
	const bytes = new Uint8Array(
		await readFile(join(manualDir(dataDir), fileName))
	);
	return { bytes, fileName, sha256: sha256Hex(bytes) };
}

async function loadSeoulMetro(dataDir: string): Promise<SourceLoad> {
	const raw = await latestRaw(dataDir, SEOUL_METRO_RAW_SOURCE);
	if (!raw) {
		return missingLoad(
			`seoul-metro-csv: data/raw/${SEOUL_METRO_RAW_SOURCE}/ 원본 없음. ${FETCH_HINT}`
		);
	}
	const parsed = parseSeoulMetroCsv(decodeCp949(raw.bytes));
	const version = seoulMetroSourceVersion(raw.fileName);
	return {
		errors: parsed.errors.map((e) => `seoul-metro-csv: ${e}`),
		manifest: {
			seoulMetroCsv: {
				fileName: `${SEOUL_METRO_RAW_SOURCE}/${raw.fileName}`,
				sha256: raw.sha256,
			},
		},
		trips: parsed.trips,
		versionFor: () => version,
	};
}

interface KricFile {
	manifest: SourceManifest;
	rows: KricRow[];
}

async function readKricFile(dataDir: string): Promise<KricFile | undefined> {
	const raw = await latestRaw(dataDir, KRIC_RAW_SOURCE);
	if (!raw) {
		return undefined;
	}
	return {
		manifest: {
			kricFile: {
				fileName: `${KRIC_RAW_SOURCE}/${raw.fileName}`,
				sha256: raw.sha256,
			},
		},
		rows: await readKricRows(raw.bytes),
	};
}

const kricMissing = (source: TimetableSourceKind) =>
	missingLoad(
		`${source}: data/raw/${KRIC_RAW_SOURCE}/ 원본(id=900) 없음. ${FETCH_HINT}`
	);

function loadKricKorail(file: KricFile | undefined): SourceLoad {
	if (!file) {
		return kricMissing("kric-korail");
	}
	const parsed = parseKricKorailRows(file.rows);
	const version = parsed.sourceVersion || UNKNOWN_VERSION;
	return {
		errors: parsed.errors.map((e) => `kric-korail: ${e}`),
		manifest: file.manifest,
		trips: parsed.trips,
		versionFor: () => version,
	};
}

function loadKricPacked(file: KricFile | undefined): SourceLoad {
	if (!file) {
		return kricMissing("kric-packed");
	}
	const parsed = parseKricPacked(file.rows);
	const skipped = parsed.skipped
		.filter((s) => KRIC_PACKED_LINES[s.lineName])
		.map((s) => `${s.lineName} 행을 읽지 못함(${s.reason})`);
	return {
		errors: [...parsed.errors, ...skipped].map((e) => `kric-packed: ${e}`),
		manifest: file.manifest,
		trips: parsed.trips,
		versionFor: (lineKey) => parsed.sourceVersion[lineKey] ?? UNKNOWN_VERSION,
	};
}

/** 수동 파일은 파일명의 `_YYYYMMDD`를 기준일로 본다. 없으면 "unknown". */
function manualVersion(fileName: string): string {
	return seoulMetroSourceVersion(fileName);
}

const manualManifest = (file: RawFile): SourceManifest => ({
	[`manual:${file.fileName}`]: {
		fileName: `manual/timetables/${file.fileName}`,
		sha256: file.sha256,
	},
});

async function loadKorailXlsx(
	dataDir: string,
	fileName: string,
	lineKey: LineKey
): Promise<SourceLoad> {
	const file = await readManual(dataDir, fileName);
	const parsed = await parseKorailXlsx(file.bytes, lineKey);
	const version = manualVersion(fileName);
	return {
		errors: parsed.errors.map((e) => `korail-xlsx ${fileName}: ${e}`),
		manifest: manualManifest(file),
		trips: parsed.trips,
		versionFor: () => version,
	};
}

async function loadAirportExpress(
	dataDir: string,
	fileName: string
): Promise<SourceLoad> {
	const file = await readManual(dataDir, fileName);
	const text = new TextDecoder().decode(file.bytes);
	const parsed = AIRPORT_EXPRESS_SERVICE_DAYS.map((day) =>
		parseAirportExpressCsv(text, day)
	);
	const version = manualVersion(fileName);
	return {
		errors: (parsed[0]?.errors ?? []).map(
			(e) => `airport-express-csv ${fileName}: ${e}`
		),
		manifest: manualManifest(file),
		trips: parsed.flatMap((p) => p.trips),
		versionFor: () => version,
	};
}

/** 출처별 원본을 한 번씩만 읽도록 결과를 기억한다. 수동 파일 출처는 노선마다 따로 읽는다. */
function createSourceLoader(
	dataDir: string,
	config: ReturnType<typeof parseTimetableSourcesConfig>
) {
	const loads = new Map<string, Promise<SourceLoad>>();
	let kricFile: Promise<KricFile | undefined> | undefined;
	const kric = () => {
		kricFile ??= readKricFile(dataDir);
		return kricFile;
	};
	const start = async (
		source: TimetableSourceKind,
		lineKey: LineKey
	): Promise<SourceLoad> => {
		const manualFile = config.lines[lineKey].manualFile ?? "";
		switch (source) {
			case "seoul-metro-csv":
				return await loadSeoulMetro(dataDir);
			case "kric-korail":
				return loadKricKorail(await kric());
			case "kric-packed":
				return loadKricPacked(await kric());
			case "korail-xlsx":
				return await loadKorailXlsx(dataDir, manualFile, lineKey);
			case "airport-express-csv":
				return await loadAirportExpress(dataDir, manualFile);
			case "kric-api":
				return missingLoad(
					"kric-api: GTX-A 역별 시간표 수집이 아직 없음(KRIC_SERVICE_KEY 키 대기)"
				);
			default:
				return missingLoad(`${source}: 알 수 없는 출처`);
		}
	};
	return (source: TimetableSourceKind, lineKey: LineKey) => {
		const perLine =
			source === "korail-xlsx" || source === "airport-express-csv";
		const key = perLine ? `${source}|${lineKey}` : source;
		let load = loads.get(key);
		if (!load) {
			load = start(source, lineKey);
			loads.set(key, load);
		}
		return { key, load };
	};
}

/** 역을 statn_id로 잇고 시각을 초로 바꾼다. 시각을 읽을 수 없으면 errors에 넣고 undefined. 해석 못 한 역은 빼고 resolver가 센다. */
function toTrip(
	source: SourceTrip,
	version: string,
	resolver: StationResolver,
	errors: string[]
): Trip | undefined {
	const { stops: sourceStops, sourceVersion, ...fields } = source;
	const stops: StopTime[] = [];
	for (const stop of [...sourceStops].sort((a, b) => a.seq - b.seq)) {
		const resolved = resolver.resolve({
			code: stop.station.code,
			lineKey: source.lineKey,
			name: stop.station.name,
			source: source.source,
		});
		if ("error" in resolved) {
			continue;
		}
		try {
			stops.push({
				arriveSec: parseClock(stop.arrive ?? ""),
				departSec: parseClock(stop.depart ?? ""),
				qualityFlags: [...(stop.qualityFlags ?? [])],
				seq: stop.seq,
				statnId: resolved.statnId,
			});
		} catch (error) {
			errors.push(
				`${source.source} ${source.lineKey} ${source.serviceDay} ${source.trainNo}: ${(error as Error).message}`
			);
			return undefined;
		}
	}
	const normalized = normalizeTripTimes(stops);
	return {
		...fields,
		destinationStatnId: fields.destinationStatnId ?? normalized.at(-1)?.statnId,
		originStatnId: fields.originStatnId ?? normalized[0]?.statnId,
		qualityFlags: [...fields.qualityFlags],
		sourceVersion: sourceVersion ?? version,
		stops: normalized,
	};
}

/** 같은 키에 기준일이 여럿이면 가장 늦은 날짜를 남긴다. "unknown"은 날짜에 밀린다. */
function recordVersion(
	versions: Partial<Record<string, string>>,
	key: string,
	version: string
) {
	const current = versions[key];
	const replace =
		current === undefined ||
		(version !== UNKNOWN_VERSION &&
			(current === UNKNOWN_VERSION || version > current));
	if (replace) {
		versions[key] = version;
	}
}

function lineReport(resolved: ResolvedLineSources, trips: Trip[]): LineReport {
	const byServiceDay: Record<ServiceDay, number> = {
		holiday: 0,
		saturday: 0,
		weekday: 0,
	};
	const versions: LineReport["versions"] = {};
	for (const trip of trips) {
		byServiceDay[trip.serviceDay] += 1;
		recordVersion(versions, trip.source, trip.sourceVersion);
	}
	return {
		byServiceDay,
		lineKey: resolved.lineKey,
		missing: resolved.missing,
		saturdayCopied: trips.some(
			(t) =>
				t.serviceDay === "saturday" && t.serviceDaySource === "holiday-copied"
		),
		sources: resolved.sources,
		trips: trips.length,
		versions,
	};
}

export interface BuildTimetableInput {
	dataDir: string;
	db: Database;
	dryRun: boolean;
	/** KRIC_SERVICE_KEY 유무를 볼 환경. 기본 process.env. */
	env?: Record<string, string | undefined>;
	now?: Date;
}

export interface BuildTimetableResult {
	batchId?: number;
	issues: TimetableIssue[];
	linesWithoutTimetable: LineKey[];
	loaded: boolean;
	/** error 등급 issue 0건 그리고 대응표에 없는 역 0건. 시간표 없는 노선은 영향 없음. */
	ok: boolean;
	reportPaths: { jsonPath: string; mdPath: string };
	/** 어댑터가 버린 행·열차와 읽지 못한 시각. ok에는 들어가지 않고 보고서에 싣는다. */
	sourceErrors: string[];
	/** `<source>/<lineKey>` → 출처 기준일 */
	sourceVersions: Record<string, string>;
	tripsByLine: Record<LineKey, number>;
	unresolvedStations: UnresolvedStation[];
}

interface CollectedTrips {
	lines: LineReport[];
	manifest: SourceManifest;
	resolver: StationResolver;
	sourceErrors: string[];
	sourceVersions: Record<string, string>;
	trips: Trip[];
}

async function collectTrips(
	dataDir: string,
	resolvedLines: ResolvedLineSources[],
	config: ReturnType<typeof parseTimetableSourcesConfig>,
	resolver: StationResolver
): Promise<CollectedTrips> {
	const load = createSourceLoader(dataDir, config);
	const harvested = new Set<string>();
	const manifest: SourceManifest = {};
	const sourceErrors: string[] = [];
	const sourceVersions: Record<string, string> = {};
	const trips: Trip[] = [];
	const lines: LineReport[] = [];
	for (const resolved of resolvedLines) {
		const { lineKey } = resolved;
		const lineTrips: Trip[] = [];
		const missing = [...resolved.missing];
		for (const source of resolved.sources) {
			const { key, load: pending } = load(source, lineKey);
			// biome-ignore lint/performance/noAwaitInLoops: each source is read once and reused by later lines
			const result = await pending;
			if (!harvested.has(key)) {
				harvested.add(key);
				Object.assign(manifest, result.manifest);
				sourceErrors.push(...result.errors);
			}
			if (result.missing) {
				missing.push(result.missing);
				continue;
			}
			const version = result.versionFor(lineKey);
			for (const sourceTrip of result.trips) {
				if (sourceTrip.lineKey !== lineKey) {
					continue;
				}
				const trip = toTrip(sourceTrip, version, resolver, sourceErrors);
				if (trip) {
					lineTrips.push(trip);
					recordVersion(
						sourceVersions,
						`${trip.source}/${lineKey}`,
						trip.sourceVersion
					);
				}
			}
		}
		trips.push(...lineTrips);
		lines.push(lineReport({ ...resolved, missing }, lineTrips));
	}
	return { lines, manifest, resolver, sourceErrors, sourceVersions, trips };
}

function byFrequency(unresolved: UnresolvedStation[]): UnresolvedStation[] {
	return [...unresolved].sort(
		(a, b) =>
			b.count - a.count ||
			a.source.localeCompare(b.source) ||
			a.lineKey.localeCompare(b.lineKey) ||
			(a.name ?? a.code ?? "").localeCompare(b.name ?? b.code ?? "")
	);
}

/**
 * timetable-sources.json으로 노선마다 출처를 정해 원본(서울교통공사 CSV, KRIC id=900, 수동 파일)을 읽고,
 * 현재 crosswalk 배치로 역을 잇고, 검증하고, 보고서(data/reports/build-timetable/)를 쓴다.
 * ok이고 dryRun이 아니고 manifest가 현재 배치와 다르면 한 트랜잭션으로 적재한다.
 */
export async function buildTimetable({
	dataDir,
	db,
	dryRun,
	env = process.env,
	now = new Date(),
}: BuildTimetableInput): Promise<BuildTimetableResult> {
	const crosswalk = await loadCurrentCrosswalk(db);
	if (crosswalk.length === 0) {
		throw new Error(
			"현재 station_crosswalk 배치가 없습니다. 먼저 `bun transit build:crosswalk`를 실행하세요."
		);
	}
	const config = parseTimetableSourcesConfig(timetableSourcesJson);
	const aliases = readAliases();
	const resolvedLines = resolveSources(config, {
		hasKricKey: readKricServiceKey(env) !== undefined,
		manualFiles: await listManualFiles(dataDir),
	});
	const collected = await collectTrips(
		dataDir,
		resolvedLines,
		config,
		createStationResolver(crosswalk, aliases)
	);
	const { trips } = collected;
	const issues = validateTrips(
		trips,
		new Set(crosswalk.map((row) => row.statnId))
	);
	const unresolvedStations = byFrequency(collected.resolver.unresolved());
	const errorCount = issues.filter((i) => i.severity === "error").length;
	const ok = errorCount === 0 && unresolvedStations.length === 0;
	const tripsByLine = Object.fromEntries(
		collected.lines.map((line) => [line.lineKey, line.trips])
	) as Record<LineKey, number>;
	const linesWithoutTimetable = LINES.map((line) => line.lineKey).filter(
		(lineKey) => tripsByLine[lineKey] === 0
	);
	const manifest = timetableManifest({
		...collected.manifest,
		crosswalk: {
			fileName: `station_crosswalk current (${crosswalk.length})`,
			sha256: contentHash(crosswalk),
		},
		stationAliases: {
			fileName: "manual/timetable-station-aliases.json",
			sha256: contentHash(aliases),
		},
		timetableSources: {
			fileName: "manual/timetable-sources.json",
			sha256: contentHash(config),
		},
	});
	const reportPaths = await writeReport(
		dataDir,
		JOB_NAME,
		renderTimetableReport({
			dryRun,
			issues,
			lines: collected.lines,
			linesWithoutTimetable,
			manifest,
			now,
			ok,
			sourceErrors: collected.sourceErrors,
			sourceVersions: collected.sourceVersions,
			unresolvedStations,
		}),
		now
	);
	const result: BuildTimetableResult = {
		issues,
		linesWithoutTimetable,
		loaded: false,
		ok,
		reportPaths,
		sourceErrors: collected.sourceErrors,
		sourceVersions: collected.sourceVersions,
		tripsByLine,
		unresolvedStations,
	};
	console.log(
		`ok: ${ok}\ntrip: ${trips.length}\nerror: ${errorCount}\nwarn: ${issues.length - errorCount}\n대응표에 없는 역: ${unresolvedStations.length}\n출처 오류: ${collected.sourceErrors.length}\n시간표 없는 노선: ${linesWithoutTimetable.join(", ") || "없음"}\nreport: ${reportPaths.mdPath}`
	);
	if (!ok) {
		console.error(
			"시간표 검증 실패: DB에 적재하지 않습니다. 보고서를 보고 timetable-station-aliases.json을 고치세요."
		);
		return result;
	}
	if (dryRun) {
		console.log("dry-run: DB에 적재하지 않습니다.");
		return result;
	}
	if (trips.length === 0) {
		console.log("적재할 trip이 없습니다. 현재 배치를 그대로 둡니다.");
		return result;
	}
	if (await isCurrentManifest(db, "timetable", manifest)) {
		console.log("원본 해시가 현재 배치와 같아 다시 적재하지 않습니다.");
		return result;
	}
	const { batchId } = await loadTimetable(db, trips, manifest);
	const stopTimes = trips.reduce((sum, trip) => sum + trip.stops.length, 0);
	console.log(
		`batchId: ${batchId}\ntimetable_trip: ${trips.length}\ntimetable_stop_time: ${stopTimes}`
	);
	return { ...result, batchId, loaded: true };
}

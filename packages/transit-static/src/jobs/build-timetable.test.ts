import type { Database } from "@Betro/db";
import { referenceBatch } from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	spyOn,
} from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";
import {
	type CrosswalkRowInput,
	loadCrosswalk,
	loadCurrentTrips,
} from "../db/load";
import { LINES, type LineKey } from "../lines";
import timetableSourcesJson from "../manual/timetable-sources.json" with {
	type: "json",
};
import { rawPath } from "../paths";
import { KRIC_RAW_SOURCE } from "../sources/kric-file";
import {
	decodeCp949,
	SEOUL_METRO_RAW_SOURCE,
} from "../sources/seoul-metro-csv";
import {
	parseTimetableSourcesConfig,
	type TimetableSourcesConfig,
} from "../timetable/registry";
import { buildTimetable } from "./build-timetable";

const FIXTURE_CSV = fileURLToPath(
	new URL("../sources/__fixtures__/seoul-metro-sample.csv", import.meta.url)
);
const CSV_NAME = "서울교통공사_도시철도열차운행시각표_20260914.csv";
/** 공항철도 묶음 행 3줄: 평일 일반 A2001, 평일 직통 A1001(공덕 통과), 휴일 일반 A2002. */
const FIXTURE_KRIC = fileURLToPath(
	new URL("../sources/__fixtures__/kric-airport-sample.xlsx", import.meta.url)
);
const KRIC_NAME = "전체_도시철도운행정보_20251231.xlsx";
const AIRPORT_EXPRESS_CSV =
	"direction,departStation,departTime,arriveStation,arriveTime\nup,인천공항1터미널,05:20,서울역,06:03\n";
const FETCH_HINT = /bun transit fetch:timetable-sources/;
/** 픽스처에서 정차가 하나뿐인 토요일 K802 행. 이 행이 있으면 empty-trip error가 난다. */
const SATURDAY_SINGLE_STOP_ROW = "953,";
const NOW = new Date("2026-10-31T00:00:00Z");
const NO_KEY: Record<string, string | undefined> = {};
const RUN_BUILD_CROSSWALK = /bun transit build:crosswalk/;

const STATIONS: [LineKey, string, string][] = [
	["line1", "0150", "서울역"],
	["line1", "0151", "시청"],
	["line1", "1003", "용산"],
	["line1", "1004", "노량진"],
	["line1", "1701", "구로"],
	["line2", "0200", "까치산"],
	["line2", "0201", "시청"],
	["line2", "0210", "뚝섬"],
	["line2", "0211", "성수"],
	["line2", "0234", "신도림"],
	["line2", "0243", "충정로"],
	["line2", "0247", "도림천"],
	["airport", "A01", "서울역"],
	["airport", "A02", "공덕"],
	["airport", "A10", "인천공항1터미널"],
	["airport", "A11", "인천공항2터미널"],
];

const DEFAULT_SOURCES = parseTimetableSourcesConfig(timetableSourcesJson);
const NO_SOURCE = { primary: "kric-api" } as const;

/**
 * 픽스처가 다루는 노선만 출처를 두는 설정: 1·2호선은 서울교통공사 CSV, 공항철도는 KRIC 묶음 + 직통 CSV.
 * 나머지 노선은 kric-api(키 없음)로 두어 출처가 처음부터 없는 노선으로 넘긴다. overrides로 노선을 바꾼다.
 */
function testSources(
	overrides: Partial<TimetableSourcesConfig["lines"]> = {}
): TimetableSourcesConfig {
	const lines = Object.fromEntries(
		Object.keys(DEFAULT_SOURCES.lines).map((lineKey) => [lineKey, NO_SOURCE])
	) as TimetableSourcesConfig["lines"];
	return {
		lines: {
			...lines,
			airport: DEFAULT_SOURCES.lines.airport,
			line1: DEFAULT_SOURCES.lines.line1,
			line2: DEFAULT_SOURCES.lines.line2,
			...overrides,
		},
	};
}

const TEST_SOURCES = testSources();

function crosswalkRow([lineKey, stationCd, name]: [
	LineKey,
	string,
	string,
]): CrosswalkRowInput {
	const subwayId = lineKey === "airport" ? "1065" : `100${lineKey.slice(-1)}`;
	return {
		bldnId: stationCd,
		coordSource: "station-master",
		lat: 37.5,
		lineKey,
		lng: 127,
		matchMethod: "auto-same-line",
		nameAliases: [],
		nameCanonical: name,
		qualityFlags: [],
		stationCd,
		statnId: `${subwayId}00${stationCd.padStart(4, "0")}`,
		subwayId,
	};
}

async function fixtureCsv(dropSaturdayRow: boolean): Promise<Uint8Array> {
	const text = decodeCp949(new Uint8Array(await readFile(FIXTURE_CSV)));
	const lines = text
		.split("\n")
		.filter(
			(line) => !(dropSaturdayRow && line.startsWith(SATURDAY_SINGLE_STOP_ROW))
		);
	return new Uint8Array(iconv.encode(lines.join("\n"), "cp949"));
}

async function writeCsv(dataDir: string, dropSaturdayRow = true) {
	const path = rawPath(dataDir, SEOUL_METRO_RAW_SOURCE, CSV_NAME);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, await fixtureCsv(dropSaturdayRow));
}

async function writeKric(dataDir: string) {
	const path = rawPath(dataDir, KRIC_RAW_SOURCE, KRIC_NAME);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, await readFile(FIXTURE_KRIC));
}

async function writeManual(
	dataDir: string,
	fileName: string,
	body: Uint8Array | string
) {
	const dir = join(dataDir, "manual", "timetables");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, fileName), body);
}

const errorText = (error: Mock<typeof console.error>): string =>
	error.mock.calls.map((call) => call.join(" ")).join("\n");

async function seededDb(...skipCodes: string[]): Promise<Database> {
	const db = await createTestDb();
	await loadCrosswalk(
		db,
		STATIONS.filter(([, code]) => !skipCodes.includes(code)).map(crosswalkRow),
		{}
	);
	return db;
}

async function timetableBatches(db: Database) {
	return (await db.select().from(referenceBatch)).filter(
		(batch) => batch.kind === "timetable"
	);
}

describe("buildTimetable", () => {
	let dataDir = "";
	let log: Mock<typeof console.log>;
	let error: Mock<typeof console.error>;
	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "betro-timetable-"));
		log = spyOn(console, "log").mockImplementation(() => undefined);
		error = spyOn(console, "error").mockImplementation(() => undefined);
	});
	afterEach(async () => {
		log.mockRestore();
		error.mockRestore();
		await rm(dataDir, { force: true, recursive: true });
	});

	it("builds, reports, and loads the fixture timetable", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(true);
		expect(result.loaded).toBe(true);
		expect(result.tripsByLine.line1).toBe(2);
		expect(result.tripsByLine.line2).toBe(2);
		expect(result.linesWithoutTimetable).toContain("gtx-a");
		expect(result.linesWithoutTimetable).toContain("gyeongui-jungang");
		expect(result.linesWithoutTimetable).not.toContain("line2");
		expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
		expect(result.unresolvedStations).toEqual([]);
		expect(result.sourceVersions["seoul-metro-csv/line2"]).toBe("2026-09-14");
		expect(result.reportPaths.mdPath).toContain(
			join("reports", "build-timetable")
		);
		const markdown = await readFile(result.reportPaths.mdPath, "utf8");
		expect(markdown).toContain("gtx-a");
		expect(markdown).toContain("KRIC_SERVICE_KEY");
		const summary = JSON.parse(
			await readFile(result.reportPaths.jsonPath, "utf8")
		);
		expect(summary.ok).toBe(true);
		expect(summary.linesWithoutTimetable).toContain("gtx-a");

		const line2 = await loadCurrentTrips(db, "line2");
		expect(line2.map((t) => t.trainNo).sort()).toEqual(["2017", "5502"]);
		const loop = line2.find((t) => t.trainNo === "2017");
		expect(loop?.direction).toBe("up");
		expect(loop?.originStatnId).toBe("1002000211");
		expect(loop?.stops.map((s) => s.departSec)).toEqual([
			19_800,
			19_890,
			20_850,
			20_970,
			null,
		]);
		expect(loop?.stops[4]?.qualityFlags).toEqual(["duplicate-stop"]);
		expect((await timetableBatches(db)).length).toBe(1);

		const again = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: new Date("2026-10-31T00:00:01Z"),
			sourcesConfig: TEST_SOURCES,
		});
		expect(again.ok).toBe(true);
		expect(again.loaded).toBe(false);
		expect((await timetableBatches(db)).length).toBe(1);
	});

	it("does not load when one error issue is found", async () => {
		await writeCsv(dataDir, false);
		await writeKric(dataDir);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		const errors = result.issues.filter((i) => i.severity === "error");
		expect(errors.length).toBe(1);
		expect(errors[0]).toEqual(
			expect.objectContaining({
				code: "empty-trip",
				lineKey: "line1",
				serviceDay: "saturday",
				trainNo: "K802",
			})
		);
		expect(result.ok).toBe(false);
		expect(result.loaded).toBe(false);
		expect(await timetableBatches(db)).toEqual([]);
		expect(await readFile(result.reportPaths.mdPath, "utf8")).toContain(
			"empty-trip"
		);
	});

	it("does not load when a station is unresolved", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await seededDb("0247");
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(false);
		expect(result.loaded).toBe(false);
		expect(result.unresolvedStations).toEqual([
			{
				code: "0247",
				count: 1,
				lineKey: "line2",
				name: "도림천",
				source: "seoul-metro-csv",
			},
		]);
		expect(await timetableBatches(db)).toEqual([]);
	});

	it("drops stops at out-of-scope stations and keeps the rest of the trip", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await seededDb("0247");
		const result = await buildTimetable({
			aliases: [
				{
					lineKey: "line2",
					source: "*",
					sourceStation: "0247",
					statnId: null,
				},
			],
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(true);
		expect(result.unresolvedStations).toEqual([]);
		expect(result.excludedStations).toEqual([
			{
				code: "0247",
				count: 1,
				lineKey: "line2",
				name: "도림천",
				source: "seoul-metro-csv",
			},
		]);
		const line2 = await loadCurrentTrips(db, "line2");
		const shuttle = line2.find((t) => t.trainNo === "5502");
		expect(shuttle?.stops.map((s) => s.statnId)).toEqual([
			"1002000234",
			"1002000200",
		]);
		expect(await readFile(result.reportPaths.mdPath, "utf8")).toContain(
			"## 대응표 범위 밖으로 뺀 역"
		);
	});

	it("drops a trip left with fewer than two stops after out-of-scope stations are removed", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await seededDb("0247", "0200");
		const result = await buildTimetable({
			aliases: ["0247", "0200"].map((code) => ({
				lineKey: "line2" as const,
				source: "*" as const,
				sourceStation: code,
				statnId: null,
			})),
			dataDir,
			db,
			dryRun: true,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(true);
		expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
		expect(result.tripsByLine.line2).toBe(1);
		expect(result.sourceErrors).toContainEqual(
			expect.stringContaining("line2 weekday 5502")
		);
	});

	it("only writes the report on a dry run", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: true,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(true);
		expect(result.loaded).toBe(false);
		const summary = JSON.parse(
			await readFile(result.reportPaths.jsonPath, "utf8")
		);
		expect(summary.dryRun).toBe(true);
		expect(await timetableBatches(db)).toEqual([]);
	});

	it("keeps the KRIC direct trips when there is no airport express CSV", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(true);
		expect(result.tripsByLine.airport).toBe(4);
		const airport = await loadCurrentTrips(db, "airport");
		expect(
			airport.filter((t) => t.express === "direct").map((t) => t.trainNo)
		).toEqual(["A1001"]);
	});

	it("replaces the KRIC direct trips with the manual airport express CSV", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		await writeManual(dataDir, "airport-express.csv", AIRPORT_EXPRESS_CSV);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(true);
		expect(result.loaded).toBe(true);
		// KRIC 일반 3편(평일 A2001, 휴일·토요일 A2002) + 직통 CSV 1편 x 3요일. KRIC 직통 A1001은 빠진다.
		expect(result.tripsByLine.airport).toBe(6);
		expect(result.linesWithoutTimetable).not.toContain("airport");
		const airport = await loadCurrentTrips(db, "airport");
		const direct = airport.filter((t) => t.express === "direct");
		expect(direct.length).toBe(3);
		expect(new Set(direct.map((t) => t.source))).toEqual(
			new Set(["airport-express-csv"])
		);
		expect(airport.map((t) => t.trainNo)).not.toContain("A1001");
		expect(
			airport.filter((t) => t.source === "kric-packed").map((t) => t.express)
		).toEqual(["local", "local", "local"]);
		const summary = JSON.parse(
			await readFile(result.reportPaths.jsonPath, "utf8")
		);
		const airportLine = summary.lines.find(
			(line: { lineKey: string }) => line.lineKey === "airport"
		);
		expect(airportLine.replacedTrips).toBe(1);
		expect(await readFile(result.reportPaths.mdPath, "utf8")).toContain(
			"kric-packed trip 1건을 airport-express-csv로 바꿈"
		);
	});

	it("fails with the fetch hint when no raw source has been downloaded", async () => {
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
		});
		expect(result.ok).toBe(false);
		expect(result.loaded).toBe(false);
		const missing = result.issues.filter((i) => i.code === "source-missing");
		expect(missing.map((i) => i.lineKey).sort()).toEqual(
			LINES.map((line) => line.lineKey)
				.filter((lineKey) => lineKey !== "gtx-a")
				.sort()
		);
		expect(missing.every((i) => i.severity === "error")).toBe(true);
		expect(errorText(error)).toMatch(FETCH_HINT);
		expect(await timetableBatches(db)).toEqual([]);
	});

	it("fails when the KRIC file a chosen line needs is missing", async () => {
		await writeCsv(dataDir);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(result.ok).toBe(false);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: "source-missing",
				lineKey: "airport",
				severity: "error",
			})
		);
		expect(errorText(error)).toMatch(FETCH_HINT);
		expect(errorText(error)).toContain("(airport)");
		expect(await timetableBatches(db)).toEqual([]);
	});

	it("blocks a chosen source that makes no trips for its line", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		// 시트 이름이 다른 xlsx를 코레일 수동 파일로 넣는다: 모든 시트가 missing-sheet라 trip이 0건이다.
		await writeManual(
			dataDir,
			"korail-gyeongui-jungang.xlsx",
			new Uint8Array(await readFile(FIXTURE_KRIC))
		);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: testSources({
				"gyeongui-jungang": DEFAULT_SOURCES.lines["gyeongui-jungang"],
				line3: DEFAULT_SOURCES.lines.line3,
			}),
		});
		expect(result.ok).toBe(false);
		expect(result.loaded).toBe(false);
		const empty = result.issues.filter((i) => i.code === "source-empty");
		expect(empty.map((i) => i.lineKey).sort()).toEqual([
			"gyeongui-jungang",
			"line3",
		]);
		expect(
			empty.find((i) => i.lineKey === "gyeongui-jungang")?.detail
		).toContain("korail-xlsx");
		expect(result.sourceErrors).toContainEqual(
			expect.stringContaining("missing-sheet")
		);
		expect(await readFile(result.reportPaths.mdPath, "utf8")).toContain(
			"[error] source-empty gyeongui-jungang: korail-xlsx"
		);
		expect(await timetableBatches(db)).toEqual([]);
	});

	it("blocks a line that had trips in the current batch but has none now", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await seededDb();
		const first = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
			sourcesConfig: TEST_SOURCES,
		});
		expect(first.loaded).toBe(true);
		const second = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: new Date("2026-10-31T00:00:01Z"),
			sourcesConfig: testSources({ airport: NO_SOURCE }),
		});
		expect(second.ok).toBe(false);
		expect(second.loaded).toBe(false);
		expect(second.issues).toContainEqual(
			expect.objectContaining({ code: "line-dropped", lineKey: "airport" })
		);
		expect(second.linesWithoutTimetable).toContain("airport");
		expect((await timetableBatches(db)).length).toBe(1);
		expect((await loadCurrentTrips(db, "airport")).length).toBe(4);
	});

	it("asks to build the crosswalk first when there is no current batch", async () => {
		await writeCsv(dataDir);
		await writeKric(dataDir);
		const db = await createTestDb();
		await expect(
			buildTimetable({
				dataDir,
				db,
				dryRun: true,
				env: NO_KEY,
				now: NOW,
				sourcesConfig: TEST_SOURCES,
			})
		).rejects.toThrow(RUN_BUILD_CROSSWALK);
	});
});

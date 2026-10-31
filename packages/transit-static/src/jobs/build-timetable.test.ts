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
import type { LineKey } from "../lines";
import { rawPath } from "../paths";
import {
	decodeCp949,
	SEOUL_METRO_RAW_SOURCE,
} from "../sources/seoul-metro-csv";
import { buildTimetable } from "./build-timetable";

const FIXTURE_CSV = fileURLToPath(
	new URL("../sources/__fixtures__/seoul-metro-sample.csv", import.meta.url)
);
const CSV_NAME = "서울교통공사_도시철도열차운행시각표_20260914.csv";
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
	["airport", "A10", "인천공항1터미널"],
];

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

async function seededDb(skipCode?: string): Promise<Database> {
	const db = await createTestDb();
	await loadCrosswalk(
		db,
		STATIONS.filter(([, code]) => code !== skipCode).map(crosswalkRow),
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
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
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
		});
		expect(again.ok).toBe(true);
		expect(again.loaded).toBe(false);
		expect((await timetableBatches(db)).length).toBe(1);
	});

	it("does not load when one error issue is found", async () => {
		await writeCsv(dataDir, false);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
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
		const db = await seededDb("0247");
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: false,
			env: NO_KEY,
			now: NOW,
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

	it("only writes the report on a dry run", async () => {
		await writeCsv(dataDir);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: true,
			env: NO_KEY,
			now: NOW,
		});
		expect(result.ok).toBe(true);
		expect(result.loaded).toBe(false);
		const summary = JSON.parse(
			await readFile(result.reportPaths.jsonPath, "utf8")
		);
		expect(summary.dryRun).toBe(true);
		expect(await timetableBatches(db)).toEqual([]);
	});

	it("adds the manual airport express trips for every service day", async () => {
		await writeCsv(dataDir);
		const manualDir = join(dataDir, "manual", "timetables");
		await mkdir(manualDir, { recursive: true });
		await writeFile(
			join(manualDir, "airport-express.csv"),
			"direction,departStation,departTime,arriveStation,arriveTime\nup,인천공항1터미널,05:20,서울역,06:03\n"
		);
		const db = await seededDb();
		const result = await buildTimetable({
			dataDir,
			db,
			dryRun: true,
			env: NO_KEY,
			now: NOW,
		});
		expect(result.ok).toBe(true);
		expect(result.tripsByLine.airport).toBe(3);
		expect(result.linesWithoutTimetable).not.toContain("airport");
	});

	it("asks to build the crosswalk first when there is no current batch", async () => {
		await writeCsv(dataDir);
		const db = await createTestDb();
		await expect(
			buildTimetable({ dataDir, db, dryRun: true, env: NO_KEY, now: NOW })
		).rejects.toThrow(RUN_BUILD_CROSSWALK);
	});
});

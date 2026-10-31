import type { ServiceDay } from "@Betro/db/schema/transit";
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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTimetable } from "../db/load";
import type { LineKey } from "../lines";
import { saveRaw } from "../raw-store";
import type { RealtimeTrainRow } from "../realtime/position-parser";
import type { Trip } from "../timetable/model";
import { matchObservations, reportMatchRate } from "./report-match-rate";

const NOW = new Date("2026-10-31T09:00:00Z");

function observed(
	lineKey: LineKey,
	trainNo: string,
	overrides: Partial<RealtimeTrainRow> = {}
): RealtimeTrainRow {
	return {
		directAt: "0",
		direction: "up",
		lastRecptnDt: "20261031",
		lineKey,
		lstcarAt: "0",
		recptnDt: "2026-10-31 16:53:00",
		statnId: "1002000211",
		statnNm: "성수",
		statnTid: "1002000201",
		statnTnm: "시청",
		subwayId: "1002",
		trainNo,
		trainSttus: "1",
		updnLine: "0",
		...overrides,
	};
}

function trip(
	lineKey: LineKey,
	trainNo: string,
	serviceDay: ServiceDay = "weekday"
): Trip {
	return {
		direction: "down",
		express: "local",
		lineKey,
		qualityFlags: [],
		serviceDay,
		serviceDaySource: "source",
		source: "seoul-metro-csv",
		sourceVersion: "2026-09-14",
		stops: [
			{
				arriveSec: null,
				departSec: 18_000,
				qualityFlags: [],
				seq: 1,
				statnId: "1002000211",
			},
			{
				arriveSec: 18_120,
				departSec: null,
				qualityFlags: [],
				seq: 2,
				statnId: "1002000210",
			},
		],
		trainNo,
	};
}

describe("matchObservations", () => {
	it("matches 2 of 3 observed trains and ignores direction", () => {
		const rows = [
			observed("line2", "3017"),
			observed("line2", "1628", { direction: "down", updnLine: "1" }),
			observed("line2", "2999"),
		];
		const trips = new Map<LineKey, Trip[]>([
			[
				"line2",
				[
					trip("line2", "2017"),
					trip("line2", "1628"),
					trip("line2", "2999", "holiday"),
				],
			],
		]);
		const [line2] = matchObservations(rows, trips, "weekday");
		expect(line2).toEqual({
			lineKey: "line2",
			matched: 2,
			noRule: false,
			observed: 3,
			rate: 2 / 3,
			unmatched: ["2999"],
		});
	});
	it("gives a null rate to lines without a timetable or a rule", () => {
		const rows = [observed("line6", "6150"), observed("shinbundang", "2")];
		const result = matchObservations(
			rows,
			new Map([["line5", [trip("line5", "5104")]]]),
			"weekday"
		);
		expect(result).toEqual([
			{
				lineKey: "line6",
				matched: 0,
				noRule: false,
				observed: 1,
				rate: null,
				unmatched: [],
			},
			{
				lineKey: "shinbundang",
				matched: 0,
				noRule: true,
				observed: 1,
				rate: null,
				unmatched: [],
			},
		]);
	});
	it("matches when the second candidate is the timetable number", () => {
		const result = matchObservations(
			[observed("line4", "4327"), observed("line3", "3024")],
			new Map([
				["line3", [trip("line3", "3024K")]],
				["line4", [trip("line4", "K4327")]],
			]),
			"weekday"
		);
		expect(result.map((r) => [r.lineKey, r.matched, r.rate])).toEqual([
			["line3", 1, 1],
			["line4", 1, 1],
		]);
	});
	it("uses directAt for line9 and line1 timetable prefixes", () => {
		const result = matchObservations(
			[
				observed("line1", "0802"),
				observed("line9", "9607", { directAt: "1" }),
				observed("line9", "9014", { directAt: "1" }),
			],
			new Map([
				["line1", [trip("line1", "K802")]],
				["line9", [trip("line9", "E9607"), trip("line9", "C9014")]],
			]),
			"weekday"
		);
		expect(result.map((r) => [r.lineKey, r.matched, r.unmatched])).toEqual([
			["line1", 1, []],
			["line9", 1, ["9014"]],
		]);
	});
});

const sample = (trainNos: string[], subwayId: string) => ({
	errorMessage: {
		code: "INFO-000",
		developerMessage: "",
		link: "",
		message: "정상 처리되었습니다.",
		status: 200,
		total: trainNos.length,
	},
	realtimePositionList: trainNos.map((trainNo) => ({
		...observed("line2", trainNo),
		rowNum: 1,
		subwayId,
	})),
});

async function writeSample(dataDir: string, fileName: string, json: unknown) {
	await saveRaw(
		dataDir,
		"realtime-sample",
		fileName,
		new TextEncoder().encode(JSON.stringify(json))
	);
}

describe("reportMatchRate", () => {
	let dataDir = "";
	let log: Mock<typeof console.log>;
	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "betro-match-rate-"));
		log = spyOn(console, "log").mockImplementation(() => undefined);
	});
	afterEach(async () => {
		log.mockRestore();
		await rm(dataDir, { force: true, recursive: true });
	});

	it("reads the latest sample per line and infers the service day", async () => {
		await writeSample(
			dataDir,
			"line2-202610301653.json",
			sample(["2999"], "1002")
		);
		await writeSample(
			dataDir,
			"line2-202610311653.json",
			sample(["3017", "3018"], "1002")
		);
		await writeSample(dataDir, "gtx-a-202610311653.json", {
			code: "ERROR-337",
			message: "데이터가 없습니다.",
		});
		const db = await createTestDb();
		await loadTimetable(
			db,
			[trip("line2", "2017", "saturday"), trip("line2", "2018", "weekday")],
			{}
		);
		const result = await reportMatchRate({ dataDir, db, now: NOW });
		expect(result.serviceDays).toEqual({
			"gtx-a": "saturday",
			line2: "saturday",
		});
		expect(result.rows).toEqual([
			{
				lineKey: "line2",
				matched: 1,
				noRule: false,
				observed: 2,
				rate: 0.5,
				unmatched: ["3018"],
			},
		]);
		expect(result.failures).toEqual([
			{
				code: "ERROR-337",
				fileName: "gtx-a-202610311653.json",
				lineKey: "gtx-a",
			},
		]);
		expect(result.reportPaths.mdPath).toContain(join("reports", "match-rate"));
		const markdown = await readFile(result.reportPaths.mdPath, "utf8");
		expect(markdown).toContain("line2");
		expect(markdown).toContain("50.0%");
		expect(markdown).toContain("ERROR-337");

		const weekday = await reportMatchRate({
			dataDir,
			db,
			now: NOW,
			serviceDay: "weekday",
		});
		expect(weekday.rows[0]?.unmatched).toEqual(["3017"]);
	});
});

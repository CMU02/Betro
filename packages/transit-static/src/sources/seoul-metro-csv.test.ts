import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rawPath } from "../paths";
import {
	decodeCp949,
	fetchSeoulMetroCsv,
	parseSeoulMetroCsv,
	seoulMetroSourceVersion,
} from "./seoul-metro-csv";

const FIXTURE_PATH = fileURLToPath(
	new URL("./__fixtures__/seoul-metro-sample.csv", import.meta.url)
);

async function readFixture(): Promise<string> {
	return decodeCp949(new Uint8Array(await readFile(FIXTURE_PATH)));
}

const HEADER =
	'"고유번호","호선","역사코드","역사명","주중주말","방향","급행여부","열차코드","열차도착시간","열차출발시간","출발역","도착역"';

describe("parseSeoulMetroCsv", () => {
	it("decodes the cp949 fixture and reads the header by name", async () => {
		const { header, errors } = parseSeoulMetroCsv(await readFixture());
		expect(errors).toEqual([]);
		expect(header).toContain("열차코드");
		expect(header).toContain("역사코드");
	});

	it("groups 1호선 DAY K802 into one trip with stops in travel order", async () => {
		const { trips } = parseSeoulMetroCsv(await readFixture());
		const k802 = trips.filter(
			(candidate) =>
				candidate.lineKey === "line1" &&
				candidate.serviceDay === "weekday" &&
				candidate.trainNo === "K802"
		);
		expect(k802).toHaveLength(1);
		const [trip] = k802;
		expect(trip?.direction).toBe("up");
		expect(trip?.express).toBe("local");
		expect(trip?.source).toBe("seoul-metro-csv");
		expect(trip?.serviceDaySource).toBe("source");
		// 파일은 역사코드 순이라 시각 순으로 다시 세운다: 구로 → 용산 → 서울역 → 시청.
		expect(trip?.stops.map((stop) => [stop.seq, stop.station.code])).toEqual([
			[1, "1701"],
			[2, "1003"],
			[3, "0150"],
			[4, "0151"],
		]);
		expect(trip?.stops[0]).toEqual({
			arrive: null,
			depart: "05:00:00",
			seq: 1,
			station: { code: "1701", name: "구로" },
		});
	});

	it("keeps the station code as a string with its leading zero", async () => {
		const { trips } = parseSeoulMetroCsv(await readFixture());
		const codes = trips.flatMap((trip) =>
			trip.stops.map((stop) => stop.station.code)
		);
		expect(codes).toContain("0151");
	});

	it("separates the same train code by service day", async () => {
		const { trips } = parseSeoulMetroCsv(await readFixture());
		const saturday = trips.find(
			(trip) => trip.trainNo === "K802" && trip.serviceDay === "saturday"
		);
		expect(saturday?.stops).toHaveLength(1);
	});

	it("turns 00:00:00 into null and marks 급행여부 1 as express", async () => {
		const { trips } = parseSeoulMetroCsv(await readFixture());
		const k1902 = trips.find((trip) => trip.trainNo === "K1902");
		expect(k1902?.express).toBe("express");
		expect(k1902?.stops).toEqual([
			{
				arrive: "07:11:00",
				depart: null,
				seq: 1,
				station: { code: "1004", name: "노량진" },
			},
			{
				arrive: null,
				depart: "07:13:30",
				seq: 2,
				station: { code: "1003", name: "용산" },
			},
		]);
	});

	it("maps 2호선 IN to up and flags the repeated loop station", async () => {
		const { trips } = parseSeoulMetroCsv(await readFixture());
		const loop = trips.find(
			(trip) => trip.lineKey === "line2" && trip.trainNo === "2017"
		);
		expect(loop?.direction).toBe("up");
		expect(loop?.stops.map((stop) => stop.station.code)).toEqual([
			"0211",
			"0210",
			"0201",
			"0243",
			"0211",
		]);
		expect(loop?.stops[0]?.qualityFlags).toBeUndefined();
		expect(loop?.stops[4]?.qualityFlags).toEqual(["duplicate-stop"]);
	});

	it("keeps 2호선 branch trains with UP/DOWN directions", async () => {
		const { trips } = parseSeoulMetroCsv(await readFixture());
		const branch = trips.find((trip) => trip.trainNo === "5502");
		expect(branch?.lineKey).toBe("line2");
		expect(branch?.direction).toBe("up");
		expect(branch?.stops.map((stop) => stop.station.name)).toEqual([
			"신도림",
			"도림천",
			"까치산",
		]);
	});

	it("reports an unknown service day with its row number and drops the row", () => {
		const text = [
			HEADER,
			'1,"1","0150",서울역,DAY,UP,"0",K802,"05:20:00","05:20:30",구로,동두천',
			'2,"1","0150",서울역,MON,UP,"0",K802,"05:20:00","05:20:30",구로,동두천',
		].join("\r\n");
		const { trips, errors } = parseSeoulMetroCsv(text);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("MON");
		expect(errors[0]).toContain("row 3");
		expect(trips).toHaveLength(1);
	});

	it("accepts the 'N호선' spelling of the line column", () => {
		const text = [
			HEADER,
			'1,"9호선","4101",개화,DAY,DOWN,"1",9001,,"05:30:00",개화,중앙보훈병원',
		].join("\r\n");
		const { trips, errors } = parseSeoulMetroCsv(text);
		expect(errors).toEqual([]);
		expect(trips[0]?.lineKey).toBe("line9");
		expect(trips[0]?.direction).toBe("down");
		expect(trips[0]?.express).toBe("express");
	});

	it("reports a missing header column instead of guessing positions", () => {
		const { trips, errors } = parseSeoulMetroCsv(
			'"호선","역사코드"\r\n"1","0150"'
		);
		expect(trips).toEqual([]);
		expect(errors[0]).toContain("열차코드");
	});
});

describe("seoulMetroSourceVersion", () => {
	it("reads the _YYYYMMDD stamp from the file name", () => {
		expect(
			seoulMetroSourceVersion(
				"서울교통공사_도시철도열차운행시각표_20260914.csv"
			)
		).toBe("2026-09-14");
	});
	it("returns unknown without a stamp", () => {
		expect(seoulMetroSourceVersion("timetable.csv")).toBe("unknown");
	});
});

const CSV_BODY = new Uint8Array([0x22, 0xb0, 0xed, 0x22, 0x0d, 0x0a]);
const SAMPLE_URL = "https://example.test/timetable";
const NOT_CSV = /not a CSV/;

function respondWith(response: () => Response): typeof fetch {
	return (() => Promise.resolve(response())) as unknown as typeof fetch;
}

describe("fetchSeoulMetroCsv", () => {
	it("saves the body under the UTF-8 file name from Content-Disposition", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-seoul-metro-"));
		try {
			const utf8Name = "서울교통공사_도시철도열차운행시각표_20260914.csv";
			// 서버는 UTF-8 바이트를 그대로 보내고 fetch는 바이트 하나를 한 글자로 돌려준다.
			const latin1Name = String.fromCharCode(
				...new TextEncoder().encode(utf8Name)
			);
			const result = await fetchSeoulMetroCsv(
				dataDir,
				SAMPLE_URL,
				respondWith(
					() =>
						new Response(CSV_BODY, {
							headers: {
								"content-disposition": `attachment; filename="${latin1Name}"`,
							},
						})
				)
			);
			expect(result.fileName).toBe(utf8Name);
			expect(result.path).toBe(
				rawPath(dataDir, "seoul-metro-timetable", utf8Name)
			);
			expect(existsSync(result.path)).toBe(true);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});

	it("falls back to timetable.csv and strips path parts from the name", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-seoul-metro-"));
		try {
			const fallback = await fetchSeoulMetroCsv(
				dataDir,
				SAMPLE_URL,
				respondWith(() => new Response(CSV_BODY))
			);
			expect(fallback.fileName).toBe("timetable.csv");

			const traversal = await fetchSeoulMetroCsv(
				dataDir,
				SAMPLE_URL,
				respondWith(
					() =>
						new Response(CSV_BODY, {
							headers: {
								"content-disposition": 'attachment; filename="../../evil.csv"',
							},
						})
				)
			);
			expect(traversal.fileName).toBe("evil.csv");
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});

	it("throws on an HTML error page and writes nothing", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "betro-seoul-metro-"));
		try {
			await expect(
				fetchSeoulMetroCsv(
					dataDir,
					SAMPLE_URL,
					respondWith(
						() =>
							new Response("<html>오류</html>", {
								headers: { "content-type": "text/html;charset=UTF-8" },
							})
					)
				)
			).rejects.toThrow(NOT_CSV);
			expect(
				existsSync(rawPath(dataDir, "seoul-metro-timetable", "timetable.csv"))
			).toBe(false);
		} finally {
			await rm(dataDir, { force: true, recursive: true });
		}
	});
});

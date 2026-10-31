import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseClock } from "../timetable/clock";
import type { KricRow } from "./kric-file";
import { parseKricPacked } from "./kric-packed";

/** 실제 id=900 파일(전체_도시철도운행정보_20260630.xlsx)에서 꺼낸 행. */
const SAMPLE: KricRow[] = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("./__fixtures__/kric-packed-sample.json", import.meta.url)
		),
		"utf8"
	)
);

const SECONDS_PER_DAY = 86_400;
const SILLIM = "수도권 경량도시철도 신림선";
const UI_SINSEOL = "수도권 경량도시철도 우이신설선";

function sampleRow(lineName: string, trainNo: string): KricRow {
	const row = SAMPLE.find(
		(r) => r.lineName === lineName && r.trainNo === trainNo
	);
	if (!row) {
		throw new Error(`fixture row missing: ${lineName} ${trainNo}`);
	}
	return row;
}

describe("parseKricPacked", () => {
	const result = parseKricPacked(SAMPLE);
	const tripOf = (lineKey: string, trainNo: string, serviceDay = "weekday") =>
		result.trips.find(
			(t) =>
				t.lineKey === lineKey &&
				t.trainNo === trainNo &&
				t.serviceDay === serviceDay
		);

	it("parses a Shinbundang train with station names and source times", () => {
		const trip = tripOf("shinbundang", "B344");
		expect(trip).toBeDefined();
		expect(trip?.source).toBe("kric-packed");
		expect(trip?.direction).toBe("up");
		expect(trip?.express).toBe("local");
		expect(trip?.sourceVersion).toBe("2026-06-18");
		expect(trip?.stops).toHaveLength(8);
		expect(trip?.stops[0]).toEqual({
			arrive: "10:17",
			depart: "10:19",
			seq: 1,
			station: { name: "광교" },
		});
		expect(trip?.stops[7]).toEqual({
			arrive: "10:39",
			depart: null,
			seq: 8,
			station: { name: "정자" },
		});
		expect(tripOf("shinbundang", "B065")?.direction).toBe("down");
		expect(tripOf("shinbundang", "B059", "saturday")?.direction).toBe("up");
	});

	it("turns an empty Ui-Sinseol time ':' into null", () => {
		const trip = tripOf("ui-sinseol", "1001");
		expect(trip?.direction).toBe("up");
		expect(trip?.stops[0]).toEqual({
			arrive: null,
			depart: "5:30",
			seq: 1,
			station: { name: "신설동" },
		});
		expect(trip?.stops[12]?.depart).toBeNull();
		expect(trip?.stops[12]?.station.name).toBe("북한산우이");
	});

	it("reads a Sillim time with a stray leading colon (':0:59' in the real file)", () => {
		const trip = tripOf("sillim", "1383");
		expect(trip?.stops[10]).toEqual({
			arrive: "24:59",
			depart: null,
			seq: 11,
			station: { name: "관악산" },
		});
	});

	it("moves trains that run wholly after midnight past 24:00", () => {
		const sillim = tripOf("sillim", "1383");
		expect(sillim?.stops[0]?.depart).toBe("24:42");
		const shinbundang = tripOf("shinbundang", "B296");
		expect(shinbundang?.stops[0]).toEqual({
			arrive: "24:09",
			depart: "24:10",
			seq: 1,
			station: { name: "신사" },
		});
		expect(shinbundang?.stops.at(-1)?.depart).toBe("24:32");
		const seconds = [sillim, shinbundang].flatMap((trip) =>
			(trip?.stops ?? []).flatMap((stop) => [
				parseClock(stop.arrive ?? ""),
				parseClock(stop.depart ?? ""),
			])
		);
		expect(
			seconds.filter((sec) => sec !== null && sec < SECONDS_PER_DAY)
		).toEqual([]);
	});

	it("writes the after-midnight part of a train that crosses midnight as 24:xx", () => {
		const trip = tripOf("sillim", "1373");
		expect(trip?.stops.map((stop) => [stop.arrive, stop.depart])).toEqual([
			[null, "23:52"],
			["23:53", "23:53"],
			["23:54", "23:55"],
			["23:56", "23:56"],
			["23:58", "23:58"],
			["23:59", "24:00"],
			["24:01", "24:01"],
			["24:02", "24:03"],
			["24:04", "24:05"],
			["24:07", "24:07"],
			["24:09", null],
		]);
	});

	it("marks an Airport train that skips intermediate stations as direct", () => {
		const direct = tripOf("airport", "A1001");
		expect(direct?.express).toBe("direct");
		expect(direct?.direction).toBe("down");
		expect(direct?.stops.map((s) => s.station.name)).toEqual([
			"서울",
			"인천공항1터미널",
			"인천공항2터미널",
		]);
		expect(direct?.stops[1]).toEqual({
			arrive: null,
			depart: "06:45",
			seq: 2,
			station: { name: "인천공항1터미널" },
		});
		expect(tripOf("airport", "A2001")?.express).toBe("local");
		expect(tripOf("airport", "A2002", "holiday")?.direction).toBe("up");
	});

	it("copies holiday trips to Saturday only for lines without a Saturday timetable", () => {
		const copied = tripOf("airport", "A2002", "saturday");
		expect(copied?.serviceDaySource).toBe("holiday-copied");
		const combined = tripOf("ui-sinseol", "1002", "saturday");
		expect(combined?.serviceDaySource).toBe("source");
		expect(tripOf("ui-sinseol", "1002", "holiday")?.serviceDaySource).toBe(
			"source"
		);
		expect(tripOf("sillim", "1901", "saturday")?.serviceDaySource).toBe(
			"source"
		);
		expect(tripOf("sillim", "1901", "holiday")?.direction).toBe("down");
		expect(
			result.trips.filter(
				(t) => t.lineKey === "shinbundang" && t.serviceDaySource !== "source"
			)
		).toHaveLength(0);
	});

	it("reports headway-only lines as skipped and ignores out-of-scope lines", () => {
		expect(result.skipped).toEqual([
			{ lineName: "인천지하철 2호선", reason: "headway-only" },
			{ lineName: "에버라인", reason: "headway-only" },
		]);
		expect(result.errors).toEqual([]);
		expect(new Set(result.trips.map((t) => t.lineKey))).toEqual(
			new Set(["shinbundang", "airport", "ui-sinseol", "sillim"])
		);
	});

	it("records the source date per line", () => {
		expect(result.sourceVersion).toEqual({
			airport: "2025-12-31",
			shinbundang: "2026-06-18",
			sillim: "2025-09-23",
			"ui-sinseol": "2022-05-30",
		});
	});

	it("skips an in-scope row in an unknown format", () => {
		const row = sampleRow(SILLIM, "1001");
		const broken: KricRow = {
			...row,
			depart: (row.depart ?? "").replaceAll("+", "/"),
		};
		const { skipped, trips } = parseKricPacked([broken]);
		expect(trips).toEqual([]);
		expect(skipped).toEqual([{ lineName: SILLIM, reason: "unknown-format" }]);
	});

	it("drops a row whose departure column runs backwards against the station order (신림 주말 1011)", () => {
		/** 실제 파일의 신림선 주말+공휴일 1011 행. 출발 칸 시각이 역 순서와 반대로 줄어든다. */
		const reversed: KricRow = {
			arrive:
				"001-:+002-6:21+003-6:22+004-6:24+005-6:26+006-6:27+007-6:29+008-6:30+009-6:32+010-6:35+011-6:37",
			dataDate: "2025-09-23",
			dayLabel: "주말+공휴일",
			depart:
				"001-6:40+002-6:35+003-6:33+004-6:31+005-6:29+006-6:28+007-6:26+008-6:24+009-6:23+010-6:21+011-:",
			destination: "관악산",
			lineName: SILLIM,
			operator: "02-890-2227~8",
			origin: "샛강",
			raw: {},
			serviceType: "일반",
			stationName:
				"001-샛강역+002-대방+003-서울지방병무청+004-보라매+005-보라매공원+006-보라매병원+007-당곡+008-신림+009-서원+010-서울대벤처타운+011-관악산",
			trainNo: "1011",
		};
		const { errors, trips } = parseKricPacked([
			reversed,
			sampleRow(SILLIM, "1001"),
		]);
		expect(trips.some((t) => t.trainNo === "1011")).toBe(false);
		expect(trips.some((t) => t.trainNo === "1001")).toBe(true);
		expect(errors).toEqual([
			"time-column-reversed sillim 주말+공휴일 1011: depart 칸 시각이 역 순서와 반대로 줄어듦(원문 오류)",
		]);
	});

	it("reports an unknown day label and an unknown terminal as errors", () => {
		const row = sampleRow(UI_SINSEOL, "1001");
		const { errors, trips } = parseKricPacked([
			{ ...row, dayLabel: "명절" },
			{ ...row, origin: "어딘가" },
		]);
		expect(trips).toEqual([]);
		expect(errors).toEqual([
			`unknown 요일구분 "명절" in ${UI_SINSEOL}`,
			"direction-unknown ui-sinseol 평일 1001 (어딘가->북한산우이)",
		]);
	});
});

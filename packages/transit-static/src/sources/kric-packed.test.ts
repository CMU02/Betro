import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
			arrive: "0:59",
			depart: null,
			seq: 11,
			station: { name: "관악산" },
		});
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

import type { CollectorStatus, MetricsBucket } from "@Betro/realtime/metrics";
import { describe, expect, it } from "bun:test";
import { formatKst, renderStatusPage } from "./status-page";

const MINUTE = 60_000;
/** 2026-11-04 12:00:00 KST */
const NOW = Date.UTC(2026, 10, 4, 3, 0, 0);
const LINE_ROW = /<tr class="line-row">/g;
const SOURCE_ROW = /<tr class="source-row">/g;
const POLYLINE = /<polyline class="s-subway"/g;

function bucket(
	minutesAgo: number,
	source: "subway" | "bus",
	vehicles: Record<string, number>
): MetricsBucket {
	return {
		backwards: 0,
		bucketStart: NOW - minutesAgo * MINUTE,
		calls: 4,
		errors: {},
		matched: {},
		maxFreshnessMs: 30_000,
		observed: {},
		source,
		unknownStations: 0,
		vehicles,
	};
}

function stalledStatus(): CollectorStatus {
	return {
		generatedAt: NOW,
		lines: [
			{
				backwards: 0,
				baselineRatio: 0.95,
				key: "line2",
				matchRate: 0.9,
				unknownStations: 1,
				vehicles: 40,
			},
			{
				backwards: 0,
				baselineRatio: null,
				key: "<script>x</script>",
				matchRate: null,
				unknownStations: 0,
				vehicles: 3,
			},
			{
				backwards: 2,
				baselineRatio: null,
				key: "100100290",
				matchRate: null,
				unknownStations: 0,
				vehicles: 12,
			},
		],
		mode: "dev",
		overall: "stalled",
		series: [
			bucket(30, "subway", { line2: 40 }),
			bucket(25, "subway", { line2: 41 }),
			// 20분 전 칸이 비어 선이 끊긴다.
			bucket(15, "subway", { line2: 39 }),
			bucket(10, "subway", { line2: 38 }),
			bucket(10, "bus", { "100100290": 12 }),
		],
		sources: [
			{
				errorsToday: { network: 3 },
				freshnessMs: 17 * MINUTE,
				health: "stalled",
				lastSuccessAt: NOW - 17 * MINUTE,
				name: "subway",
				remainingToday: 500,
				usedToday: 400,
			},
			{
				errorsToday: {},
				freshnessMs: 20_000,
				health: "ok",
				lastSuccessAt: NOW - MINUTE,
				name: "bus",
				remainingToday: 600,
				usedToday: 300,
			},
		],
	};
}

describe("renderStatusPage", () => {
	it("renders summary and tables", () => {
		const status = stalledStatus();
		const html = renderStatusPage(status);
		expect(html).toContain("수집 상태 <strong>멈춤</strong>");
		expect(html.match(LINE_ROW)?.length).toBe(status.lines.length);
		expect(html.match(SOURCE_ROW)?.length).toBe(status.sources.length);
		expect(html.toLowerCase()).not.toContain("<script");
		expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
		expect(html).toContain("network 3");
		expect(html).toContain("400 / 남음 500");
		expect(html).toContain("95%");
	});

	it("shows times in KST", () => {
		const html = renderStatusPage(stalledStatus());
		expect(formatKst(NOW)).toBe("2026-11-04 12:00:00");
		expect(html).toContain("2026-11-04 12:00:00 KST 기준");
		// 지하철 마지막 성공 17분 전
		expect(html).toContain("2026-11-04 11:43:00");
	});

	it("draws three charts and breaks lines at empty buckets", () => {
		const html = renderStatusPage(stalledStatus());
		expect(html.match(/<svg /g)?.length).toBe(3);
		// 지하철은 칸 하나가 비어 차트마다 선 두 개.
		expect(html.match(POLYLINE)?.length).toBe(6);
	});

	it("labels off-hours separately", () => {
		const status: CollectorStatus = {
			...stalledStatus(),
			lines: [],
			overall: "off-hours",
			series: [],
		};
		const html = renderStatusPage(status);
		expect(html).toContain("수집 상태 <strong>운행 시간 아님</strong>");
		expect(html).toContain("보이는 노선이 없습니다.");
	});
});

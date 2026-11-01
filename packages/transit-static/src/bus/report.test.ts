import { describe, expect, it } from "bun:test";
import type { AssembledBusRoute, BusAssembleResult } from "./assemble";
import { renderBusRouteReport } from "./report";

const TOP_N = 20;
// 한글이 든 String.raw는 Bun이 \u 이스케이프로 바꿔 버리므로 ASCII만 String.raw로 쓴다.
const ESCAPED_PIPE = String.raw`\|`;

function route(
	routeId: string,
	options: { offsets?: number[]; mismatches?: number } = {}
): AssembledBusRoute {
	const offsets = options.offsets ?? [1, 2];
	const stops = offsets.map((offsetM, i) => ({
		apiSectDistM: i === 0 ? 0 : 100,
		arsId: null,
		directionName: null,
		distanceM: i * 100,
		flags: offsetM > 80 ? ["stop-off-shape"] : [],
		lat: 37.5,
		lng: 127,
		name: `정류소|${i + 1}`,
		offsetM,
		routeName: `R${routeId}`,
		routeType: "4",
		seq: i + 1,
		stationId: `${i + 1}`,
	}));
	const mismatches = options.mismatches ?? 0;
	const segments = Array.from({ length: mismatches }, (_, i) => ({
		apiSectDistM: 1000 + i,
		endM: (i + 1) * 100,
		flags: ["sect-dist-mismatch"],
		fromSeq: i + 1,
		startM: i * 100,
		toSeq: i + 2,
	}));
	const issues = [
		...stops
			.filter((s) => s.flags.length > 0)
			.map((s) => ({
				code: "stop-off-shape",
				detail: `seq ${s.seq}`,
				level: "warning" as const,
			})),
		...segments.map((s) => ({
			code: "sect-dist-mismatch",
			detail: `seq ${s.fromSeq}`,
			level: "warning" as const,
		})),
	];
	return {
		coords: [
			[127, 37.5],
			[127.01, 37.5],
		],
		issues,
		lengthM: 1000,
		qualityFlags: [...new Set(issues.map((issue) => issue.code))],
		routeId,
		routeName: `R${routeId}`,
		routeType: "4",
		segments,
		stops,
	};
}

function result(
	overrides: Partial<Omit<BusAssembleResult, "markdown">> = {}
): Omit<BusAssembleResult, "markdown"> {
	return {
		excluded: [],
		missingRaw: [],
		ok: true,
		outOfScope: 0,
		routes: [route("1")],
		routeTypeCounts: { "4": 1 },
		...overrides,
	};
}

describe("renderBusRouteReport", () => {
	it("report lists route type counts and excluded routes", () => {
		const markdown = renderBusRouteReport(
			result({
				excluded: [
					{
						issues: [
							{
								code: "seq-not-contiguous",
								detail: "seq 1, 2, 4",
								level: "error",
							},
						],
						routeId: "100100999",
						routeName: "제외노선",
					},
				],
				ok: false,
				outOfScope: 3,
				routes: [route("1"), route("2")],
				routeTypeCounts: { "2": 3, "4": 2, "15": 1 },
			})
		);
		expect(markdown).toContain("| 4 |");
		expect(markdown).toContain("| 15 |");
		expect(markdown).toContain("제외노선");
		expect(markdown).toContain("100100999");
		expect(markdown).toContain("seq-not-contiguous");
		expect(markdown).toContain("ok: false");
		expect(markdown).toContain("서울특별시 버스노선정보(공공데이터포털)");
		// routeType 표는 숫자 순서(2, 4, 15).
		expect(markdown.indexOf("| 2 |")).toBeLessThan(markdown.indexOf("| 4 |"));
		expect(markdown.indexOf("| 4 |")).toBeLessThan(markdown.indexOf("| 15 |"));
	});

	it("summarizes counts and missing raw routes", () => {
		const markdown = renderBusRouteReport(
			result({ missingRaw: ["111", "222"], ok: false, outOfScope: 4 })
		);
		// 엑셀 노선 수 = 적재 1 + 제외 0 + 원본 없음 2 + 범위 밖 4.
		expect(markdown).toContain("엑셀 노선: 7");
		expect(markdown).toContain("범위 밖: 4");
		expect(markdown).toContain("원본 없음: 2");
		expect(markdown).toContain("- 111");
	});

	it("lists warning counts and the top offsets and mismatches", () => {
		const offsets = Array.from({ length: 30 }, (_, i) => i * 5);
		const markdown = renderBusRouteReport(
			result({ routes: [route("1", { mismatches: 25, offsets })] })
		);
		expect(markdown).toContain("| stop-off-shape | 13 |");
		expect(markdown).toContain("| sect-dist-mismatch | 25 |");
		// 가장 큰 오프셋(145m)이 먼저, 상위 20개만.
		expect(markdown).toContain("145.0");
		expect(markdown).not.toContain("| 45.0 |");
		const offsetSection = markdown.split("## 오프셋 상위")[1]?.split("## ")[0];
		expect(offsetSection?.match(/^\| R1 /gm)?.length).toBe(TOP_N);
		const mismatchSection = markdown
			.split("## sect-dist-mismatch 상위")[1]
			?.split("## ")[0];
		expect(mismatchSection?.match(/^\| R1 /gm)?.length).toBe(TOP_N);
		// 표 칸 안의 | 는 이스케이프한다.
		expect(markdown).toContain(`정류소${ESCAPED_PIPE}30`);
	});

	it("keeps table rows on one line when values contain line breaks", () => {
		const broken = route("1");
		const [firstStop] = broken.stops;
		if (!firstStop) {
			throw new Error("no stop");
		}
		firstStop.name = "n|1\nX";
		firstStop.offsetM = 999;
		const markdown = renderBusRouteReport(
			result({
				excluded: [
					{
						issues: [
							{ code: "bad-envelope", detail: "a\r\nb\rc", level: "error" },
						],
						routeId: "9|9",
						routeName: "줄\n바꿈",
					},
				],
				routes: [broken],
			})
		);
		expect(markdown).toContain(`| n${ESCAPED_PIPE}1 X |`);
		expect(markdown).toContain(
			`| 줄 바꿈 | 9${ESCAPED_PIPE}9 | bad-envelope | a b c |`
		);
		for (const line of markdown.split("\n")) {
			if (line.startsWith("|")) {
				expect(line.endsWith("|")).toBe(true);
			}
		}
	});
});

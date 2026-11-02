import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	assembleBusRoute,
	assembleBusRoutes,
	BUS_SHAPE_ATTRIBUTION,
	type BusIssue,
	type BusRouteRaw,
	MIN_VALID_ROUTE_RATIO,
} from "./assemble";
import { AUTONOMOUS_PILOT_ROUTES } from "./scope";

const EARTH_RADIUS_M = 6_371_008.8;
const LAT0 = 37.5;
const LNG0 = 127.0;
const DEG = Math.PI / 180;
const ROUTE_6411 = {
	maxSeq: 117,
	routeId: "100100290",
	routeName: "6411",
	stopCount: 117,
};
const IN_SCOPE_ROUTES = 100;

function fixture(name: string): string {
	return readFileSync(
		new URL(`../sources/__fixtures__/${name}`, import.meta.url),
		"utf8"
	);
}

/** (LNG0, LAT0)에서 동쪽 x m, 북쪽 y m인 점 */
function at(xM: number, yM = 0): [number, number] {
	return [
		LNG0 + xM / (EARTH_RADIUS_M * Math.cos(LAT0 * DEG) * DEG),
		LAT0 + yM / (EARTH_RADIUS_M * DEG),
	];
}

function envelope(itemList: Record<string, unknown>[]): string {
	return JSON.stringify({
		comMsgHeader: {},
		msgBody: { itemList },
		msgHeader: { headerCd: "0", headerMsg: "정상", itemCount: 0 },
	});
}

interface SyntheticStop {
	routeType?: string;
	sect: number;
	seq: number;
	xM: number;
}

function stationsBody(
	routeName: string,
	routeType: string,
	stops: readonly SyntheticStop[]
): string {
	return envelope(
		stops.map((s) => {
			const [lng, lat] = at(s.xM);
			return {
				arsId: `${10_000 + s.seq}`,
				busRouteNm: routeName,
				direction: "끝",
				fullSectDist: String(s.sect),
				gpsX: String(lng),
				gpsY: String(lat),
				routeType: s.routeType ?? routeType,
				seq: String(s.seq),
				station: `9${s.seq}`,
				stationNm: `정류소${s.seq}`,
			};
		})
	);
}

function pathBody(points: readonly [number, number][]): string {
	return envelope(
		points.map(([lng, lat], i) => ({
			gpsX: String(lng),
			gpsY: String(lat),
			no: String(i + 1),
		}))
	);
}

/** 동쪽 2km 직선 모양 위 정류소 3개(0, 1000, 2000m). */
const STRAIGHT_STOPS: SyntheticStop[] = [
	{ sect: 0, seq: 1, xM: 0 },
	{ sect: 1000, seq: 2, xM: 1000 },
	{ sect: 1000, seq: 3, xM: 2000 },
];
const STRAIGHT_PATH = pathBody([at(0), at(1000), at(2000)]);

function straightRaw(
	routeId: string,
	options: {
		routeName?: string;
		routeType?: string;
		stops?: SyntheticStop[];
	} = {}
): BusRouteRaw {
	const stops = options.stops ?? STRAIGHT_STOPS;
	const routeName = options.routeName ?? `R${routeId}`;
	return {
		entry: {
			maxSeq: stops.length,
			routeId,
			routeName,
			stopCount: stops.length,
		},
		pathBody: STRAIGHT_PATH,
		stationsBody: stationsBody(routeName, options.routeType ?? "4", stops),
	};
}

/** 300m 간격 정류소 count개, 첫 정류소 뒤 모든 구간의 API 거리는 sect. */
function evenStops(count: number, sect: number): SyntheticStop[] {
	return Array.from({ length: count }, (_, i) => ({
		sect: i === 0 ? 0 : sect,
		seq: i + 1,
		xM: i * 300,
	}));
}

const errorsOf = (issues: readonly BusIssue[]): BusIssue[] =>
	issues.filter((issue) => issue.level === "error");
const codesOf = (issues: readonly { code: string }[]) =>
	issues.map((issue) => issue.code);

describe("assembleBusRoute", () => {
	it("assembles the 6411 fixture", () => {
		const result = assembleBusRoute({
			entry: ROUTE_6411,
			pathBody: fixture("bus-path-6411.json"),
			stationsBody: fixture("bus-stations-6411.json"),
		});
		expect(result.outOfScope).toBe(false);
		expect(errorsOf(result.issues)).toEqual([]);
		const { route } = result;
		expect(route).toBeDefined();
		expect(route?.routeId).toBe("100100290");
		expect(route?.routeName).toBe("6411");
		expect(route?.stops.length).toBe(117);
		expect(route?.segments.length).toBe(116);
		expect(route?.coords.length).toBeGreaterThan(1000);
		expect(route?.lengthM).toBeGreaterThan(10_000);
		// 정류소 행과 투영 결과가 합쳐져 있다.
		expect(route?.stops[0]?.stationId).toBe("114000124");
		expect(route?.stops[0]?.distanceM).toBeGreaterThan(0);
	});

	it("marks route type 2 as out of scope without requiring a path", () => {
		const raw = straightRaw("200", { routeType: "2" });
		const result = assembleBusRoute({ ...raw, pathBody: undefined });
		expect(result.outOfScope).toBe(true);
		expect(result.route).toBeUndefined();
		expect(errorsOf(result.issues)).toEqual([]);
		expect(result.routeType).toBe("2");
	});

	it("decides scope from parsed rows even when a station row is bad", () => {
		const raw = straightRaw("201", { routeType: "8" });
		const items = JSON.parse(raw.stationsBody ?? "").msgBody.itemList;
		items[1].gpsX = "";
		const result = assembleBusRoute({
			...raw,
			pathBody: undefined,
			stationsBody: envelope(items),
		});
		expect(result.outOfScope).toBe(true);
		expect(result.routeType).toBe("8");
		expect(errorsOf(result.issues)).toEqual([]);
	});

	it("rejects an in-scope route with a bad station row", () => {
		const raw = straightRaw("202");
		const items = JSON.parse(raw.stationsBody ?? "").msgBody.itemList;
		items[1].gpsX = "";
		const result = assembleBusRoute({ ...raw, stationsBody: envelope(items) });
		expect(result.outOfScope).toBe(false);
		expect(result.route).toBeUndefined();
		expect(result.routeType).toBe("4");
		expect(codesOf(errorsOf(result.issues))).toEqual(["bad-station-row"]);
		// 모든 행이 깨지면 routeType을 알 수 없어 범위 판정 전에 뺀다.
		const allBad = items.map((item: Record<string, unknown>) => ({
			...item,
			gpsX: "",
		}));
		const unreadable = assembleBusRoute({
			...raw,
			stationsBody: envelope(allBad),
		});
		expect(unreadable.routeType).toBeUndefined();
		expect(codesOf(unreadable.issues)).toEqual(["bad-station-row"]);
	});

	it("uses the first row in API order for scope, like the fetch job", () => {
		// 응답이 seq 순서가 아니고 routeType이 섞여 있으면 첫 행(API 순서)을 따른다.
		const result = assembleBusRoute(
			straightRaw("203", {
				stops: [
					{ routeType: "2", sect: 1000, seq: 2, xM: 1000 },
					{ routeType: "4", sect: 0, seq: 1, xM: 0 },
					{ routeType: "4", sect: 1000, seq: 3, xM: 2000 },
				],
			})
		);
		expect(result.outOfScope).toBe(true);
		expect(result.routeType).toBe("2");
		expect(codesOf(result.issues)).toEqual(["mixed-route-type"]);
	});

	it("keeps raw body text out of bad-envelope details", () => {
		const raw = straightRaw("204");
		const xmlError =
			"<ServiceResult><msgHeader><headerCd>7</headerCd><headerMsg>인증 실패</headerMsg></msgHeader><serviceKey>SECRETKEY</serviceKey></ServiceResult>";
		const jsonError = JSON.stringify({
			msgHeader: { headerCd: "3", headerMsg: "서버 오류" },
			serviceKey: "SECRETKEY",
		});
		for (const body of [xmlError, jsonError, "plain SECRETKEY text"]) {
			const fromStations = assembleBusRoute({ ...raw, stationsBody: body });
			const fromPath = assembleBusRoute({ ...raw, pathBody: body });
			for (const issue of [...fromStations.issues, ...fromPath.issues]) {
				expect(issue.detail).not.toContain("SECRETKEY");
			}
			expect(codesOf(fromStations.issues)).toContain("bad-envelope");
			expect(codesOf(fromPath.issues)).toContain("bad-envelope");
		}
		const headerOnly = assembleBusRoute({ ...raw, pathBody: jsonError });
		expect(
			headerOnly.issues.find((issue) => issue.code === "bad-envelope")?.detail
		).toBe("getRoutePath error: headerCd 3: 서버 오류");
	});

	it("rejects non-contiguous seq", () => {
		const result = assembleBusRoute(
			straightRaw("300", {
				stops: [
					{ sect: 0, seq: 1, xM: 0 },
					{ sect: 1000, seq: 2, xM: 1000 },
					{ sect: 1000, seq: 4, xM: 2000 },
				],
			})
		);
		expect(result.route).toBeUndefined();
		expect(codesOf(errorsOf(result.issues))).toContain("seq-not-contiguous");
	});

	it("rejects duplicate seq", () => {
		const result = assembleBusRoute(
			straightRaw("301", {
				stops: [
					{ sect: 0, seq: 1, xM: 0 },
					{ sect: 1000, seq: 2, xM: 1000 },
					{ sect: 1000, seq: 2, xM: 2000 },
				],
			})
		);
		expect(result.route).toBeUndefined();
		expect(codesOf(errorsOf(result.issues))).toContain("seq-not-contiguous");
	});

	it("compares the xlsx max 순번, not its row count, with the API stop count", () => {
		const assemble6411 = (entry: typeof ROUTE_6411) =>
			assembleBusRoute({
				entry,
				pathBody: fixture("bus-path-6411.json"),
				stationsBody: fixture("bus-stations-6411.json"),
			});
		// 가상 정류소 행 하나가 빠져도 순번이 117까지 있으면 경고하지 않는다.
		const omittedRow = assemble6411({ ...ROUTE_6411, stopCount: 116 });
		expect(codesOf(omittedRow.issues)).not.toContain(
			"xlsx-stop-count-mismatch"
		);

		const changed = assemble6411({
			...ROUTE_6411,
			maxSeq: 116,
			stopCount: 116,
		});
		expect(changed.route).toBeDefined();
		expect(errorsOf(changed.issues)).toEqual([]);
		expect(
			changed.issues.find((issue) => issue.code === "xlsx-stop-count-mismatch")
		).toEqual({
			code: "xlsx-stop-count-mismatch",
			detail: "xlsx max seq 116 (116 rows), api 117",
			level: "warning",
		});
		expect(changed.route?.qualityFlags).toContain("xlsx-stop-count-mismatch");
	});

	it("keeps an autonomous pilot route in scope by default", () => {
		const raw = straightRaw("100000024", {
			routeName: "새벽A160",
			routeType: "3",
		});
		const result = assembleBusRoute(raw);
		expect(result.outOfScope).toBe(false);
		expect(result.route?.routeId).toBe("100000024");
	});

	it("marks a listed route ID as out of scope without requiring a path", () => {
		const raw = straightRaw("100000024", {
			routeName: "새벽A160",
			routeType: "3",
		});
		const result = assembleBusRoute(
			{ ...raw, pathBody: undefined },
			{ excludedRouteIds: AUTONOMOUS_PILOT_ROUTES }
		);
		expect(result.outOfScope).toBe(true);
		expect(result.outOfScopeBy).toBe("id");
		expect(result.route).toBeUndefined();
		expect(errorsOf(result.issues)).toEqual([]);
		expect(result.routeType).toBe("3");
	});

	it("warns sect-dist-scale when fullSectDist is about double", () => {
		const doubled = assembleBusRoute(
			straightRaw("710", { stops: evenStops(7, 600) })
		);
		expect(doubled.route).toBeDefined();
		const scale = doubled.issues.filter(
			(issue) => issue.code === "sect-dist-scale"
		);
		expect(scale).toEqual([
			{
				code: "sect-dist-scale",
				detail: "median shape/api 0.500 over 6 segments",
				level: "warning",
			},
		]);
		expect(doubled.route?.qualityFlags).toContain("sect-dist-scale");

		const matching = assembleBusRoute(
			straightRaw("711", { stops: evenStops(7, 300) })
		);
		expect(codesOf(matching.issues)).not.toContain("sect-dist-scale");

		// 구간이 SECT_SCALE_MIN_SEGMENTS보다 적으면 중앙값을 믿지 않는다.
		const short = assembleBusRoute(
			straightRaw("712", { stops: evenStops(4, 600) })
		);
		expect(short.route).toBeDefined();
		expect(codesOf(short.issues)).not.toContain("sect-dist-scale");
	});

	it("warns sect-dist-scale when fullSectDist is about half", () => {
		const halved = assembleBusRoute(
			straightRaw("713", { stops: evenStops(7, 150) })
		);
		expect(codesOf(halved.issues)).toContain("sect-dist-scale");
	});

	it("does not warn sect-dist-scale on the 6411 fixture", () => {
		const result = assembleBusRoute({
			entry: ROUTE_6411,
			pathBody: fixture("bus-path-6411.json"),
			stationsBody: fixture("bus-stations-6411.json"),
		});
		expect(result.route?.qualityFlags).not.toContain("sect-dist-scale");
	});

	it("reports missing raw files", () => {
		const raw = straightRaw("400");
		expect(codesOf(assembleBusRoute({ entry: raw.entry }).issues)).toContain(
			"missing-stations"
		);
		expect(
			codesOf(assembleBusRoute({ ...raw, pathBody: undefined }).issues)
		).toContain("missing-path");
	});

	it("turns a saved route-not-found body into a route-not-found error, not missing raw", () => {
		const raw = straightRaw("450");
		const notFoundBody = JSON.stringify({
			msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." },
		});
		const stations = assembleBusRoute({ ...raw, stationsBody: notFoundBody });
		expect(stations.outOfScope).toBe(false);
		expect(codesOf(stations.issues)).toEqual(["route-not-found"]);
		const path = assembleBusRoute({ ...raw, pathBody: notFoundBody });
		expect(path.route).toBeUndefined();
		expect(codesOf(errorsOf(path.issues))).toEqual(["route-not-found"]);
	});

	it("rejects bad envelopes, empty stop lists and short shapes", () => {
		const raw = straightRaw("500");
		const badBody = JSON.stringify({
			msgHeader: { headerCd: "2", headerMsg: "기타 오류" },
		});
		expect(
			codesOf(assembleBusRoute({ ...raw, stationsBody: badBody }).issues)
		).toContain("bad-envelope");
		expect(
			codesOf(assembleBusRoute({ ...raw, pathBody: badBody }).issues)
		).toContain("bad-envelope");
		expect(
			codesOf(assembleBusRoute({ ...raw, stationsBody: envelope([]) }).issues)
		).toContain("no-stops");
		const short = assembleBusRoute({
			...raw,
			pathBody: pathBody([at(0), at(50)]),
		});
		expect(short.route).toBeUndefined();
		expect(codesOf(short.issues)).toContain("shape-too-short");
		expect(
			codesOf(assembleBusRoute({ ...raw, pathBody: pathBody([at(0)]) }).issues)
		).toContain("shape-too-short");
	});

	it("warns on mixed route types and keeps the first value", () => {
		const result = assembleBusRoute(
			straightRaw("600", {
				stops: [
					{ routeType: "3", sect: 0, seq: 1, xM: 0 },
					{ routeType: "4", sect: 1000, seq: 2, xM: 1000 },
					{ routeType: "4", sect: 1000, seq: 3, xM: 2000 },
				],
			})
		);
		expect(result.route?.routeType).toBe("3");
		expect(result.route?.qualityFlags).toEqual(["mixed-route-type"]);
	});

	it("turns projection flags into warnings with unique quality flags", () => {
		const result = assembleBusRoute(
			straightRaw("700", {
				stops: [
					{ sect: 0, seq: 1, xM: 0 },
					// 실제 간격 1000m인데 API는 3000m.
					{ sect: 3000, seq: 2, xM: 1000 },
					{ sect: 3000, seq: 3, xM: 2000 },
				],
			})
		);
		expect(result.route).toBeDefined();
		const mismatches = result.issues.filter(
			(issue) => issue.code === "sect-dist-mismatch"
		);
		expect(mismatches.length).toBe(2);
		expect(mismatches.every((issue) => issue.level === "warning")).toBe(true);
		expect(result.route?.qualityFlags).toEqual(["sect-dist-mismatch"]);
		expect(result.route?.segments[0]?.flags).toEqual(["sect-dist-mismatch"]);
	});
});

describe("assembleBusRoutes", () => {
	const inScope = (count: number): BusRouteRaw[] =>
		Array.from({ length: count }, (_, i) => straightRaw(`${1000 + i}`));
	const broken = (raw: BusRouteRaw): BusRouteRaw => ({
		...raw,
		stationsBody: stationsBody(raw.entry.routeName, "4", [
			{ sect: 0, seq: 1, xM: 0 },
			{ sect: 1000, seq: 3, xM: 1000 },
		]),
	});

	it("assembleBusRoutes ok rule", () => {
		expect(MIN_VALID_ROUTE_RATIO).toBe(0.98);
		const outOfScope = straightRaw("9000", { routeType: "2" });
		const twoBad = inScope(IN_SCOPE_ROUTES).map((raw, i) =>
			i < 2 ? broken(raw) : raw
		);
		const passing = assembleBusRoutes([...twoBad, outOfScope]);
		expect(passing.ok).toBe(true);
		expect(passing.routes.length).toBe(98);
		expect(passing.excluded.length).toBe(2);
		expect(passing.excluded[0]?.issues[0]?.code).toBe("seq-not-contiguous");
		expect(passing.outOfScope).toBe(1);
		expect(passing.missingRaw).toEqual([]);
		expect(passing.routeTypeCounts).toEqual({ "2": 1, "4": 100 });

		const threeBad = inScope(IN_SCOPE_ROUTES).map((raw, i) =>
			i < 3 ? broken(raw) : raw
		);
		expect(assembleBusRoutes(threeBad).ok).toBe(false);

		const [first, ...rest] = inScope(IN_SCOPE_ROUTES);
		if (!first) {
			throw new Error("no routes");
		}
		const missing = assembleBusRoutes([
			{ ...first, pathBody: undefined },
			...rest,
		]);
		expect(missing.missingRaw).toEqual([first.entry.routeId]);
		expect(missing.excluded).toEqual([]);
		expect(missing.ok).toBe(false);
	});

	it("counts route-not-found routes as excluded against the ratio", () => {
		const notFoundBody = JSON.stringify({
			msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." },
		});
		const withNotFound = (count: number) =>
			inScope(IN_SCOPE_ROUTES).map((raw, i) => {
				if (i >= count) {
					return raw;
				}
				return i % 2 === 0
					? { entry: raw.entry, stationsBody: notFoundBody }
					: { ...raw, pathBody: notFoundBody };
			});
		const passing = assembleBusRoutes(withNotFound(2));
		expect(passing.missingRaw).toEqual([]);
		expect(passing.excluded.map((route) => route.routeId)).toEqual([
			"1000",
			"1001",
		]);
		expect(passing.excluded.map((route) => codesOf(route.issues))).toEqual([
			["route-not-found"],
			["route-not-found"],
		]);
		expect(passing.ok).toBe(true);
		expect(assembleBusRoutes(withNotFound(3)).ok).toBe(false);
	});

	it("counts out-of-scope routes with a bad row as out of scope", () => {
		const raw = straightRaw("9002", { routeType: "9" });
		const items = JSON.parse(raw.stationsBody ?? "").msgBody.itemList;
		items[2].fullSectDist = "12.5";
		const result = assembleBusRoutes([
			...inScope(2),
			{ ...raw, pathBody: undefined, stationsBody: envelope(items) },
		]);
		expect(result.outOfScope).toBe(1);
		expect(result.excluded).toEqual([]);
		expect(result.routeTypeCounts).toEqual({ "4": 2, "9": 1 });
		expect(result.ok).toBe(true);
	});

	it("throws on duplicate route IDs", () => {
		const raw = straightRaw("9003");
		expect(() => assembleBusRoutes([raw, raw])).toThrow(
			"duplicate routeId 9003"
		);
	});

	it("re-exports the shape attribution", () => {
		expect(BUS_SHAPE_ATTRIBUTION).toBe(
			"서울특별시 버스노선정보(공공데이터포털)"
		);
	});

	it("is not ok without any loadable route", () => {
		expect(assembleBusRoutes([]).ok).toBe(false);
		expect(
			assembleBusRoutes([straightRaw("9001", { routeType: "2" })]).ok
		).toBe(false);
	});

	it("lists routes excluded by ID and marks new autonomous-looking names", () => {
		const pilot = straightRaw("100000020", {
			routeName: "청와대A01",
			routeType: "5",
		});
		const lookalike = straightRaw("9100", {
			routeName: "테스트A01",
			routeType: "4",
		});
		const result = assembleBusRoutes(
			[
				...inScope(2),
				{ ...pilot, pathBody: undefined },
				lookalike,
				{ ...straightRaw("9101", { routeType: "2" }), pathBody: undefined },
			],
			{ excludedRouteIds: AUTONOMOUS_PILOT_ROUTES }
		);
		expect(result.outOfScope).toBe(2);
		expect(result.outOfScopeById).toEqual([
			{ routeId: "100000020", routeName: "청와대A01", routeType: "5" },
		]);
		expect(result.excluded).toEqual([]);
		expect(result.routes.map((route) => route.routeId)).toContain("9100");
		expect(result.routeTypeCounts).toEqual({ "2": 1, "4": 3, "5": 1 });
		expect(result.markdown).toContain("범위 밖: 2 (유형 1, ID 1)");
		const byId = result.markdown.split("## ID로 뺀 노선")[1]?.split("## ")[0];
		expect(byId).toContain("| 청와대A01 | 100000020 | 5 |");
		const review = result.markdown
			.split("## 범위 안 자율주행 시범버스")[1]
			?.split("## ")[0];
		expect(review).toContain("| 테스트A01 | 9100 | 새 노선 |");
	});

	it("loads autonomous pilots by default and lists them as known in the report", () => {
		const pilot = straightRaw("100000020", {
			routeName: "청와대A01",
			routeType: "5",
		});
		const result = assembleBusRoutes([...inScope(2), pilot]);
		expect(result.outOfScope).toBe(0);
		expect(result.outOfScopeById).toEqual([]);
		expect(result.routes.map((route) => route.routeId)).toContain("100000020");
		const review = result.markdown
			.split("## 범위 안 자율주행 시범버스")[1]
			?.split("## ")[0];
		expect(review).toContain("| 청와대A01 | 100000020 | 알려진 노선 |");
	});

	it("includes the rendered report", () => {
		const result = assembleBusRoutes(inScope(2));
		expect(result.markdown).toContain("# 버스 노선 조립 보고서");
	});
});

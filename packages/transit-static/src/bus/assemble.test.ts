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

const EARTH_RADIUS_M = 6_371_008.8;
const LAT0 = 37.5;
const LNG0 = 127.0;
const DEG = Math.PI / 180;
const ROUTE_6411 = { routeId: "100100290", routeName: "6411", stopCount: 117 };
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
	options: { routeType?: string; stops?: SyntheticStop[] } = {}
): BusRouteRaw {
	const stops = options.stops ?? STRAIGHT_STOPS;
	return {
		entry: { routeId, routeName: `R${routeId}`, stopCount: stops.length },
		pathBody: STRAIGHT_PATH,
		stationsBody: stationsBody(`R${routeId}`, options.routeType ?? "4", stops),
	};
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

	it("warns on xlsx stop count mismatch", () => {
		const result = assembleBusRoute({
			entry: { ...ROUTE_6411, stopCount: 116 },
			pathBody: fixture("bus-path-6411.json"),
			stationsBody: fixture("bus-stations-6411.json"),
		});
		expect(result.route).toBeDefined();
		expect(errorsOf(result.issues)).toEqual([]);
		expect(codesOf(result.issues)).toContain("xlsx-stop-count-mismatch");
		expect(result.route?.qualityFlags).toContain("xlsx-stop-count-mismatch");
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

	it("rejects bad envelopes, empty stop lists and short shapes", () => {
		const raw = straightRaw("500");
		const badBody = JSON.stringify({
			msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." },
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

	it("includes the rendered report", () => {
		const result = assembleBusRoutes(inScope(2));
		expect(result.markdown).toContain("# 버스 노선 조립 보고서");
	});
});

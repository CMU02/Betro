import {
	busRoute,
	busRouteShape,
	referenceBatch,
} from "@Betro/db/schema/transit";
import { createTestDb } from "@Betro/db/test-db";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { rawPath } from "../paths";
import { buildBusRoutes, busRouteManifest } from "./build-bus-routes";
import { fetchBusRoutes } from "./fetch-bus-routes";

const RUN_ROUTE_LIST_FIRST = /fetch:bus-route-list/;

const ROUTE = {
	maxSeq: 117,
	routeId: "100100290",
	routeName: "6411",
	stopCount: 117,
};

function fixture(name: string): Promise<string> {
	return readFile(
		new URL(`../sources/__fixtures__/${name}`, import.meta.url),
		"utf8"
	);
}

async function putRaw(dataDir: string, source: string, body: string) {
	const path = rawPath(dataDir, source, `${ROUTE.routeId}.json`);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, body);
	return path;
}

describe("busRouteManifest", () => {
	const xlsx = { fileName: "routes-seq58.xlsx", sha256: "aa" };
	it("changes when any route raw changes", () => {
		const base = [
			{ pathSha: "p1", routeId: "1", stationsSha: "s1" },
			{ pathSha: "p2", routeId: "2", stationsSha: "s2" },
		];
		const changed = [base[0], { ...base[1], pathSha: "p3" }];
		expect(busRouteManifest(xlsx, base).routeRaw).not.toEqual(
			busRouteManifest(xlsx, changed as typeof base).routeRaw
		);
	});
	it("ignores input order", () => {
		const a = { pathSha: "p1", routeId: "1", stationsSha: "s1" };
		const b = { pathSha: "p2", routeId: "2", stationsSha: "s2" };
		expect(busRouteManifest(xlsx, [a, b])).toEqual(
			busRouteManifest(xlsx, [b, a])
		);
	});
});

describe("buildBusRoutes", () => {
	let dataDir = "";
	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "betro-bus-"));
		await putRaw(
			dataDir,
			"bus-route-stations",
			await fixture("bus-stations-6411.json")
		);
		await putRaw(
			dataDir,
			"bus-route-path",
			await fixture("bus-path-6411.json")
		);
	});
	afterEach(async () => {
		await rm(dataDir, { force: true, recursive: true });
	});

	it("skips reload for the same manifest", async () => {
		const db = await createTestDb();
		const first = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [ROUTE],
		});
		expect(first.ok).toBe(true);
		expect(first.batchId).toBeDefined();
		const second = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [ROUTE],
		});
		expect(second.batchId).toBeUndefined();
		expect(await readFile(first.mdPath, "utf8")).toContain("6411");
		expect(await readFile(second.jsonPath, "utf8")).toContain("ok");
	});

	it("asks for fetch:bus-route-list when the route list is missing", async () => {
		const db = await createTestDb();
		await expect(buildBusRoutes({ dataDir, db, dryRun: true })).rejects.toThrow(
			RUN_ROUTE_LIST_FIRST
		);
	});

	it("loads headway and first/last bus minutes from the route list entry", async () => {
		const db = await createTestDb();
		const result = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [
				{
					...ROUTE,
					firstBusMinute: 270,
					headwayMin: 13,
					lastBusMinute: 1370,
				},
			],
		});
		expect(result.ok).toBe(true);
		const [row] = await db.select().from(busRoute);
		expect(row).toMatchObject({
			firstBusMinute: 270,
			headwayMin: 13,
			lastBusMinute: 1370,
		});
	});

	it("loads the short name from the route list entry", async () => {
		const db = await createTestDb();
		const result = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [{ ...ROUTE, shortName: "6411번" }],
		});
		expect(result.ok).toBe(true);
		const [row] = await db.select().from(busRoute);
		expect(row?.shortName).toBe("6411번");
		expect(row?.region).toBe("seoul");
	});

	it("does not load when ok is false", async () => {
		await rm(rawPath(dataDir, "bus-route-path", `${ROUTE.routeId}.json`));
		const db = await createTestDb();
		const result = await buildBusRoutes({
			dataDir,
			db,
			dryRun: false,
			routes: [ROUTE],
		});
		expect(result.ok).toBe(false);
		expect(result.batchId).toBeUndefined();
		expect(await db.select().from(referenceBatch)).toHaveLength(0);
	});

	it("treats a route the API reports as not found as excluded, not missing raw", async () => {
		const gone = {
			maxSeq: 10,
			routeId: "999999999",
			routeName: "폐선",
			stopCount: 10,
		};
		const stations = await fixture("bus-stations-6411.json");
		const path = await fixture("bus-path-6411.json");
		const fetchImpl = ((input: string | URL | Request) => {
			const url = new URL(String(input));
			const routeId = url.searchParams.get("busRouteId");
			const operation = url.pathname.split("/").at(-1);
			if (routeId === gone.routeId) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							msgBody: { itemList: null },
							msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." },
						}),
						{ status: 200 }
					)
				);
			}
			return Promise.resolve(
				new Response(operation === "getStaionByRoute" ? stations : path, {
					status: 200,
				})
			);
		}) as unknown as typeof fetch;
		const routes = [ROUTE, gone];
		for (let run = 0; run < 2; run += 1) {
			// biome-ignore lint/performance/noAwaitInLoops: 같은 dataDir에서 수집과 조립을 두 번 차례로 돌린다
			const fetched = await fetchBusRoutes({
				dataDir,
				delayMs: 0,
				fetchImpl,
				key: "test-key",
				retryDelaysMs: [0, 0, 0],
				routes,
			});
			expect(fetched.notFound).toEqual([gone.routeId]);
			const built = await buildBusRoutes({
				dataDir,
				db: await createTestDb(),
				dryRun: true,
				routes,
			});
			const summary = JSON.parse(await readFile(built.jsonPath, "utf8"));
			expect(summary.missingRaw).toEqual([]);
			expect(summary.loaded).toBe(1);
			expect(summary.excluded).toEqual([
				{
					issues: [
						{
							code: "route-not-found",
							detail: "getStaionByRoute headerCd 4",
							level: "error",
						},
					],
					region: "seoul",
					routeId: gone.routeId,
					routeName: gone.routeName,
				},
			]);
			// 1/2만 적재 가능해 비율 기준(0.98)으로만 ok가 아니다.
			expect(built.ok).toBe(false);
		}
	});

	describe("GBIS·TAGO 노선", () => {
		const GBIS_ID = "241308701";
		const gbisRow = (routeId: string) => ({
			areaName: "고양",
			cityCode: null,
			name: "011",
			routeId,
			routeTypeCode: "30",
		});
		async function putRegional(
			source: string,
			fileName: string,
			body: string
		): Promise<string> {
			const path = rawPath(dataDir, source, fileName);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, body);
			return path;
		}
		async function putGbisRoute(routeId: string) {
			await putRegional(
				"gbis-route-stations",
				`${routeId}.json`,
				await fixture(`gbis-route-stations-${GBIS_ID}.json`)
			);
			await putRegional(
				"gbis-route-info",
				`${routeId}.json`,
				await fixture(`gbis-route-info-${GBIS_ID}.json`)
			);
		}
		const putGbisList = (rows: unknown[]) =>
			putRegional(
				"gbis-route-list",
				"2026-11-20/routes.json",
				`${JSON.stringify(rows)}\n`
			);

		it("서울 노선과 함께 적재하고 출처 표기를 붙인다", async () => {
			await putGbisList([gbisRow(GBIS_ID)]);
			await putGbisRoute(GBIS_ID);
			const db = await createTestDb();
			const result = await buildBusRoutes({
				dataDir,
				db,
				dryRun: false,
				routes: [ROUTE],
			});
			expect(result.ok).toBe(true);
			const rows = await db.select().from(busRoute);
			expect(rows.map((row) => [row.source, row.routeId])).toEqual([
				["seoul", ROUTE.routeId],
				["gbis", GBIS_ID],
			]);
			const gbis = rows.find((row) => row.source === "gbis");
			expect(gbis).toMatchObject({
				areaName: "고양",
				headwayMin: 10,
				region: "gyeonggi",
				sourceCity: null,
			});
			const shapes = await db
				.select({
					attribution: busRouteShape.attribution,
					busRouteId: busRouteShape.busRouteId,
				})
				.from(busRouteShape);
			expect(
				shapes.find((shape) => shape.busRouteId === gbis?.id)?.attribution
			).toBe("경기도 버스정보(GBIS)");
			const [batch] = await db.select().from(referenceBatch);
			expect(Object.keys(batch?.sourceManifest ?? {})).toContain(
				"gbisRouteList"
			);
			expect(Object.keys(batch?.sourceManifest ?? {})).not.toContain(
				"tagoRouteList"
			);
			expect(await readFile(result.mdPath, "utf8")).toContain("gbis");
		});

		it("서울 노선과 같은 ID의 GBIS 노선은 버리고 서울 행만 남긴다", async () => {
			await putGbisList([gbisRow(ROUTE.routeId)]);
			await putGbisRoute(ROUTE.routeId);
			const db = await createTestDb();
			const result = await buildBusRoutes({
				dataDir,
				db,
				dryRun: false,
				routes: [ROUTE],
			});
			expect(result.ok).toBe(true);
			const rows = await db.select().from(busRoute);
			expect(rows.map((row) => [row.source, row.routeId])).toEqual([
				["seoul", ROUTE.routeId],
			]);
		});

		it("적재 가능 비율이 90% 미만이면 적재하지 않는다", async () => {
			await putGbisList([gbisRow(GBIS_ID), gbisRow("241308702")]);
			await putGbisRoute(GBIS_ID);
			const db = await createTestDb();
			const result = await buildBusRoutes({
				dataDir,
				db,
				dryRun: false,
				routes: [ROUTE],
			});
			expect(result.ok).toBe(false);
			expect(await db.select().from(referenceBatch)).toHaveLength(0);
			const summary = JSON.parse(await readFile(result.jsonPath, "utf8"));
			expect(summary.regional.gbis).toMatchObject({
				inScope: 2,
				loadable: 1,
				missingRaw: ["241308702"],
			});
		});

		it("GBIS 원본이 바뀌면 다시 적재한다", async () => {
			await putGbisList([gbisRow(GBIS_ID)]);
			await putGbisRoute(GBIS_ID);
			const db = await createTestDb();
			const options = { dataDir, db, dryRun: false, routes: [ROUTE] };
			expect((await buildBusRoutes(options)).batchId).toBeDefined();
			const stations = JSON.parse(
				await fixture(`gbis-route-stations-${GBIS_ID}.json`)
			);
			await putRegional(
				"gbis-route-stations",
				`${GBIS_ID}.json`,
				JSON.stringify(stations)
			);
			expect((await buildBusRoutes(options)).batchId).toBeDefined();
		});
	});

	it("does not load on dry-run", async () => {
		const db = await createTestDb();
		const result = await buildBusRoutes({
			dataDir,
			db,
			dryRun: true,
			routes: [ROUTE],
		});
		expect(result.ok).toBe(true);
		expect(result.batchId).toBeUndefined();
		expect(await db.select().from(referenceBatch)).toHaveLength(0);
	});
});

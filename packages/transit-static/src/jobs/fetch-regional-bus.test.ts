import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRegionalRoutes } from "./fetch-regional-bus";

const FIXTURE_DIR = new URL("../sources/__fixtures__/", import.meta.url);
const TEST_KEY = "test-key-for-fetch";
const NOW = new Date("2026-11-21T03:00:00Z");
const GBIS_TERM_COUNT = 14;
const TAGO_ROUTE_COUNT = 363;
const SMALL_BUDGET = 2;

async function fixtureText(name: string): Promise<string> {
	return await readFile(new URL(name, FIXTURE_DIR), "utf8");
}

/** 에러 자료는 `{ httpStatus, body }`로 감싸 있다. */
async function errorBody(name: string): Promise<string> {
	const wrapped = JSON.parse(await fixtureText(name)) as { body: string };
	return wrapped.body;
}

interface FakeFetch {
	calls: string[];
	fetchImpl: typeof fetch;
}

/** URL에 들어 있는 오퍼레이션 이름으로 응답을 고르는 가짜 fetch. */
function fakeFetch(
	respond: (url: URL, callIndex: number) => string | Promise<string>
): FakeFetch {
	const calls: string[] = [];
	const fetchImpl = (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		calls.push(url.pathname.split("/").pop() ?? "");
		const text = await respond(url, calls.length);
		return new Response(text, { status: 200 });
	}) as typeof fetch;
	return { calls, fetchImpl };
}

function gbisList(types: { id: number; type: number }[]): string {
	return JSON.stringify({
		response: {
			msgBody: {
				busRouteList: types.map(({ id, type }) => ({
					regionName: "고양,서울",
					routeId: id,
					routeName: String(id),
					routeTypeCd: type,
				})),
			},
			msgHeader: { resultCode: 0 },
		},
	});
}

async function withTempDir(
	run: (dataDir: string) => Promise<void>
): Promise<void> {
	const dataDir = await mkdtemp(join(tmpdir(), "regional-bus-"));
	try {
		await run(dataDir);
	} finally {
		await rm(dataDir, { force: true, recursive: true });
	}
}

const noSleep = () => Promise.resolve();

async function gbisResponder(url: URL, routes: string): Promise<string> {
	const operation = url.pathname.split("/").pop();
	if (operation === "getBusRouteListv2") {
		return routes;
	}
	if (operation === "getBusRouteInfoItemv2") {
		return await fixtureText("gbis-route-info-241308701.json");
	}
	return await fixtureText("gbis-route-stations-241308701.json");
}

function count(calls: string[], operation: string): number {
	return calls.filter((call) => call === operation).length;
}

describe("fetchRegionalRoutes (gbis)", () => {
	it("검색어별 목록을 합쳐 routeId로 중복을 지우고 합친 목록을 남긴다", async () => {
		await withTempDir(async (dataDir) => {
			const routes = gbisList([
				{ id: 1, type: 13 },
				{ id: 2, type: 30 },
			]);
			const fake = fakeFetch((url) => gbisResponder(url, routes));
			const result = await fetchRegionalRoutes({
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "gbis",
			});
			expect(result.routes).toBe(2);
			expect(result.fetched.list).toBe(GBIS_TERM_COUNT);
			expect(result.fetched.info).toBe(2);
			expect(result.fetched.stations).toBe(2);
			expect(result.stoppedBy).toBeNull();
			expect(result.ok).toBe(true);
			const merged = JSON.parse(
				await readFile(
					join(dataDir, "raw", "gbis-route-list", "2026-11-21", "routes.json"),
					"utf8"
				)
			) as { routeId: string }[];
			expect(merged.map((row) => row.routeId)).toEqual(["1", "2"]);
		});
	});

	it("검색어 하나라도 일시 오류면 합친 목록을 쓰지 않아 빠진 노선이 적재 비율에 숨지 않는다", async () => {
		await withTempDir(async (dataDir) => {
			const routes = gbisList([{ id: 1, type: 13 }]);
			const fake = fakeFetch((url) =>
				url.searchParams.get("keyword") === "3"
					? "<html>temporary</html>"
					: gbisResponder(url, routes)
			);
			const result = await fetchRegionalRoutes({
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "gbis",
			});
			expect(result.ok).toBe(false);
			const listDir = join(dataDir, "raw", "gbis-route-list", "2026-11-21");
			expect(await readdir(listDir)).not.toContain("routes.json");
		});
	});

	it("이미 원본이 있는 노선과 목록은 다시 부르지 않는다", async () => {
		await withTempDir(async (dataDir) => {
			const routes = gbisList([{ id: 1, type: 13 }]);
			const options = {
				dataDir,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "gbis" as const,
			};
			await fetchRegionalRoutes({
				...options,
				fetchImpl: fakeFetch((url) => gbisResponder(url, routes)).fetchImpl,
			});
			const second = fakeFetch((url) => gbisResponder(url, routes));
			const result = await fetchRegionalRoutes({
				...options,
				fetchImpl: second.fetchImpl,
			});
			expect(second.calls).toEqual([]);
			expect(result.fetched).toEqual({ info: 0, list: 0, stations: 0 });
			expect(result.routes).toBe(1);
			expect(result.ok).toBe(true);
		});
	});

	it("한 오퍼레이션이 호출 상한에 이르면 budget으로 멈추고 받은 원본은 남긴다", async () => {
		await withTempDir(async (dataDir) => {
			const routes = gbisList([
				{ id: 1, type: 13 },
				{ id: 2, type: 13 },
				{ id: 3, type: 13 },
				{ id: 4, type: 13 },
			]);
			const fake = fakeFetch((url) => gbisResponder(url, routes));
			const result = await fetchRegionalRoutes({
				callsPerOperation: SMALL_BUDGET,
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "gbis",
				terms: ["1"],
			});
			expect(result.stoppedBy).toBe("budget");
			expect(result.ok).toBe(false);
			expect(result.fetched.info).toBe(SMALL_BUDGET);
			expect(result.fetched.stations).toBe(SMALL_BUDGET);
			expect(
				await readdir(join(dataDir, "raw", "gbis-route-info"))
			).toHaveLength(SMALL_BUDGET);
		});
	});

	it("quota 응답이 오면 바로 멈추고 그때까지 받은 원본은 남긴다", async () => {
		await withTempDir(async (dataDir) => {
			const routes = gbisList([
				{ id: 1, type: 13 },
				{ id: 2, type: 13 },
			]);
			const quota = await errorBody("gbis-error-quota.json");
			const fake = fakeFetch((url, index) => {
				const operation = url.pathname.split("/").pop();
				// 목록 한 번 + 노선 1의 info·stations 뒤, 노선 2의 info에서 한도 응답
				const quotaAt = 4;
				if (index === quotaAt && operation === "getBusRouteInfoItemv2") {
					return quota;
				}
				return gbisResponder(url, routes);
			});
			const result = await fetchRegionalRoutes({
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "gbis",
				terms: ["1"],
			});
			expect(result.stoppedBy).toBe("quota");
			expect(result.ok).toBe(false);
			expect(fake.calls).toHaveLength(4);
			expect(
				await readdir(join(dataDir, "raw", "gbis-route-stations"))
			).toEqual(["1.json"]);
		});
	});

	it("인증 실패 응답이 오면 auth로 멈춘다", async () => {
		await withTempDir(async (dataDir) => {
			const auth = await errorBody("tago-error-auth.json");
			const fake = fakeFetch(() => auth);
			const result = await fetchRegionalRoutes({
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "gbis",
			});
			expect(result.stoppedBy).toBe("auth");
			expect(fake.calls).toHaveLength(1);
		});
	});

	it("시외·고속·공항 유형은 노선 정보도 경유 정류장도 받지 않는다", async () => {
		await withTempDir(async (dataDir) => {
			const routes = gbisList([
				{ id: 1, type: 13 },
				{ id: 2, type: 41 },
				{ id: 3, type: 43 },
				{ id: 4, type: 52 },
			]);
			const fake = fakeFetch((url) => gbisResponder(url, routes));
			const result = await fetchRegionalRoutes({
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "gbis",
				terms: ["1"],
			});
			expect(count(fake.calls, "getBusRouteStationListv2")).toBe(1);
			expect(count(fake.calls, "getBusRouteInfoItemv2")).toBe(1);
			expect(result.fetched.stations).toBe(1);
		});
	});

	it("요청 사이에 100ms를 쉰다", async () => {
		await withTempDir(async (dataDir) => {
			const routes = gbisList([{ id: 1, type: 13 }]);
			const fake = fakeFetch((url) => gbisResponder(url, routes));
			const waits: number[] = [];
			await fetchRegionalRoutes({
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: (ms) => {
					waits.push(ms);
					return Promise.resolve();
				},
				source: "gbis",
				terms: ["1"],
			});
			expect(fake.calls).toHaveLength(3);
			expect(waits).toEqual([100, 100]);
		});
	});
});

describe("fetchRegionalRoutes (tago)", () => {
	it("인천 목록 한 번과 노선별 정보·경유 정류장을 받는다", async () => {
		await withTempDir(async (dataDir) => {
			const fake = fakeFetch(async (url) => {
				const operation = url.pathname.split("/").pop();
				if (operation === "getRouteNoList") {
					expect(url.searchParams.get("cityCode")).toBe("23");
					return await fixtureText("tago-route-list-23.json");
				}
				if (operation === "getRouteInfoIem") {
					return await fixtureText("tago-route-info.json");
				}
				return await fixtureText("tago-route-stations.json");
			});
			const result = await fetchRegionalRoutes({
				callsPerOperation: SMALL_BUDGET,
				dataDir,
				fetchImpl: fake.fetchImpl,
				key: TEST_KEY,
				now: () => NOW,
				sleep: noSleep,
				source: "tago",
			});
			expect(result.routes).toBe(TAGO_ROUTE_COUNT);
			expect(result.fetched).toEqual({
				info: SMALL_BUDGET,
				list: 1,
				stations: SMALL_BUDGET,
			});
			expect(result.stoppedBy).toBe("budget");
			expect(
				(
					await readdir(join(dataDir, "raw", "tago-route-list", "2026-11-21"))
				).sort()
			).toEqual(["23.json", "routes.json"]);
		});
	});
});

// 5-A Task 1 일회성 확인 스크립트. 경기 GBIS와 인천 TAGO 응답을 한 번씩 받아 테스트 자료로 남긴다.
// 서울행 인천 노선의 정류장 대조(ICB 역변환)는 getRouteAcctoThrghSttnList를 노선 여섯 개에 더 불러 같은 방식으로 확인했다.
// 실행: bun run scripts/probe-regional-bus.ts <output-name>
// 결과는 실행 위치 아래 probe-out/<output-name>/에만 쓴다. 이름은 영문·숫자·-·_만 받는다.
// 키는 packages/transit-static/.env의 DATA_GO_KR_API_KEY에서 읽고, 출력에는 maskKey를 쓴다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareCodeUnits } from "../src/compare";
import { maskKey } from "../src/sources/seoul-bus-api";

const GBIS_BASE = "https://apis.data.go.kr/6410000/busrouteservice/v2";
const TAGO_BASE = "https://apis.data.go.kr/1613000/BusRouteInfoInqireService";
const MAX_CALLS = 30;
const ENV_PATH = new URL("../.env", import.meta.url).pathname;
const KEY_LINE_RE = /^DATA_GO_KR_API_KEY\s*=\s*"?([^"\s]+)"?/m;
const GBIS_SEARCH_TERMS = [..."0123456789", "M", "G", "N", "P"];

const OUTPUT_NAME_RE = /^[\w-]+$/;
const [, , outputName] = process.argv;
if (!(outputName && OUTPUT_NAME_RE.test(outputName))) {
	throw new Error("출력 이름(영문·숫자·-·_)을 인자로 주세요");
}
// 인자는 폴더 이름으로만 쓰고 경로로 해석하지 않는다(상위 폴더로 벗어나지 못하게 한다).
const outDir = join(resolve("probe-out"), outputName);
mkdirSync(outDir, { recursive: true });
const key = KEY_LINE_RE.exec(readFileSync(ENV_PATH, "utf8"))?.[1];
if (!key) {
	throw new Error("DATA_GO_KR_API_KEY가 .env에 없습니다");
}

let calls = 0;

async function call(
	base: string,
	operation: string,
	params: Record<string, string>,
	useKey = key
): Promise<{ status: number; text: string }> {
	calls += 1;
	if (calls > MAX_CALLS) {
		throw new Error("호출 한도(30)를 넘습니다");
	}
	const query = new URLSearchParams({ serviceKey: useKey, ...params });
	const res = await fetch(`${base}/${operation}?${query.toString()}`);
	const text = maskKey(await res.text(), key as string);
	console.log(
		maskKey(
			`${calls} ${operation} ${res.status} ${text.length}B`,
			key as string
		)
	);
	return { status: res.status, text };
}

function save(name: string, text: string): void {
	if (text.includes(key as string)) {
		throw new Error(`${name}에 키가 들어 있습니다`);
	}
	writeFileSync(join(outDir, name), text.endsWith("\n") ? text : `${text}\n`);
}

function parse(text: string): unknown {
	return JSON.parse(text);
}

function listOf(value: unknown): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	const walk = (v: unknown): void => {
		if (Array.isArray(v)) {
			for (const item of v) {
				if (item && typeof item === "object" && !Array.isArray(item)) {
					out.push(item as Record<string, unknown>);
				}
			}
			return;
		}
		if (v && typeof v === "object") {
			for (const child of Object.values(v)) {
				walk(child);
			}
		}
	};
	walk(value);
	return out;
}

// GBIS
const gbis = (op: string, params: Record<string, string>) =>
	call(GBIS_BASE, op, { format: "json", ...params });
const list11 = await gbis("getBusRouteListv2", { keyword: "11" });
save("gbis-route-list-11.json", list11.text);
const info = await gbis("getBusRouteInfoItemv2", { routeId: "241308701" });
save("gbis-route-info-241308701.json", info.text);
const st1 = await gbis("getBusRouteStationListv2", { routeId: "241308701" });
save("gbis-route-stations-241308701.json", st1.text);
const st2 = await gbis("getBusRouteStationListv2", { routeId: "234001243" });
save("gbis-route-stations-234001243.json", st2.text);

// TAGO
const tago = (op: string, params: Record<string, string>) =>
	call(TAGO_BASE, op, { _type: "json", cityCode: "23", ...params });
const tagoList = await tago("getRouteNoList", {
	numOfRows: "3000",
	pageNo: "1",
});
save("tago-route-list-23.json", tagoList.text);
const tagoRoutes = listOf(parse(tagoList.text)).filter((r) => r.routeid);
console.log(`TAGO routes ${tagoRoutes.length}`);
const [first] = tagoRoutes;
if (first) {
	const routeId = String(first.routeid);
	const tinfo = await tago("getRouteInfoIem", { routeId });
	save("tago-route-info.json", tinfo.text);
	const tst = await tago("getRouteAcctoThrghSttnList", {
		numOfRows: "500",
		pageNo: "1",
		routeId,
	});
	save("tago-route-stations.json", tst.text);
}

// GBIS 검색어 집합 합계(자료로는 저장하지 않는다)
const seen = new Set<string>();
const typeCounts = new Map<string, number>();
const regionSamples = new Set<string>();
for (const term of GBIS_SEARCH_TERMS) {
	// 한도를 세며 차례로 부르려고 순차 실행한다
	// biome-ignore lint/performance/noAwaitInLoops: 호출 수를 세며 하나씩 부른다
	const r = await gbis("getBusRouteListv2", { keyword: term });
	let rows: Record<string, unknown>[] = [];
	try {
		rows = listOf(parse(r.text)).filter((x) => x.routeId !== undefined);
	} catch {
		console.log(`parse fail ${term}`);
	}
	console.log(`term ${term}: ${rows.length}`);
	for (const row of rows) {
		seen.add(String(row.routeId));
		const t = `${row.routeTypeCd}:${row.routeTypeName}`;
		typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
		const region = String(row.regionName);
		if (region.includes(",") || region.includes("/") || region.includes(" ")) {
			regionSamples.add(region);
		}
	}
}
console.log(`GBIS unique routes ${seen.size}`);
console.log(
	JSON.stringify(
		[...typeCounts.entries()].sort(([a], [b]) => compareCodeUnits(a, b))
	)
);
console.log(JSON.stringify([...regionSamples].slice(0, 10)));

// 인증 실패 봉투(잘못된 키 한 번)
const bad = await call(
	TAGO_BASE,
	"getRouteNoList",
	{ _type: "json", cityCode: "23" },
	"invalid-key-for-envelope-check"
);
save(
	"tago-error-auth.json",
	JSON.stringify({ body: bad.text, httpStatus: bad.status }, null, 2)
);
console.log(`calls ${calls}`);

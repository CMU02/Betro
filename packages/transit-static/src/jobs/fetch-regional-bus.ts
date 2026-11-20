import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isInScopeRegionalRoute } from "../bus/scope";
import { rawPath } from "../paths";
import { readRaw, saveRaw } from "../raw-store";
import {
	gbisUrl,
	parseGbisRouteInfo,
	parseGbisRouteList,
	parseGbisRouteStations,
} from "../sources/gbis-api";
import type {
	RegionalEnvelope,
	RegionalFailReason,
	RegionalRouteRow,
} from "../sources/regional-bus-types";
import { maskKey } from "../sources/seoul-bus-api";
import {
	parseTagoRouteInfo,
	parseTagoRouteList,
	parseTagoRouteStations,
	tagoUrl,
} from "../sources/tago-api";
import {
	BUS_CALLS_PER_OPERATION_PER_RUN,
	BUS_REQUEST_DELAY_MS,
} from "./fetch-bus-routes";

export type RegionalSource = "gbis" | "tago";
type Step = "list" | "info" | "stations";

export interface FetchRegionalResult {
	fetched: { list: number; info: number; stations: number };
	ok: boolean;
	routes: number;
	stoppedBy: "quota" | "auth" | "budget" | null;
}

export interface FetchRegionalOptions {
	/** 오퍼레이션마다 한 번 실행에서 부를 수 있는 상한. 기본은 서울 job과 같은 950건. */
	callsPerOperation?: number;
	dataDir: string;
	fetchImpl?: typeof fetch;
	key: string;
	now?: () => Date;
	sleep?: (ms: number) => Promise<void>;
	source: RegionalSource;
	/** 목록 검색어. 기본은 출처별 고정 집합(GBIS 14개, TAGO는 인천 cityCode 하나). */
	terms?: readonly string[];
}

/** GBIS 검색은 노선 이름 부분 일치라 숫자와 M·G·N·P로 불러야 겹침을 뺀 전체가 나온다(실험 1절 5-A 확인). */
const GBIS_TERMS: readonly string[] = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"M",
	"G",
	"N",
	"P",
];
const TAGO_INCHEON_CITY_CODE = "23";
const TAGO_LIST_ROWS = "3000";
const TAGO_STATION_ROWS = "500";
const LIST_FRESH_DAYS = 7;
const DAY_MS = 86_400_000;
const DATE_LENGTH = 10;
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
/** 검색어별 목록을 합친 파일 이름. `<source>-route-list/<UTC 날짜>/routes.json`에 쓴다. */
export const REGIONAL_ROUTES_FILE = "routes.json";

/** 원본 저장 폴더 이름(`gbis-route-list`, `tago-route-stations` 등). */
export const regionalRawSource = (source: RegionalSource, step: Step): string =>
	`${source}-route-${step}`;
const STEP_SOURCE = regionalRawSource;

/** 원본 파일 이름으로 써도 되는 노선 ID인지. 아니면 받지도 읽지도 않는다. */
export const isSafeRegionalRouteId = (routeId: string): boolean =>
	SAFE_ID_RE.test(routeId);

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

type CallOutcome =
	| { ok: true; text: string; reason: null }
	| { ok: false; reason: RegionalFailReason };

class RegionalFetcher {
	readonly result: FetchRegionalResult = {
		fetched: { info: 0, list: 0, stations: 0 },
		ok: true,
		routes: 0,
		stoppedBy: null,
	};
	private readonly calls: Record<Step, number> = {
		info: 0,
		list: 0,
		stations: 0,
	};
	private readonly stopped: Record<Step, boolean> = {
		info: false,
		list: false,
		stations: false,
	};
	private totalCalls = 0;
	private failures = 0;
	private readonly options: FetchRegionalOptions;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly budget: number;

	constructor(options: FetchRegionalOptions) {
		this.options = options;
		this.sleep = options.sleep ?? defaultSleep;
		this.budget = options.callsPerOperation ?? BUS_CALLS_PER_OPERATION_PER_RUN;
	}

	get halted(): boolean {
		return (
			this.result.stoppedBy === "quota" || this.result.stoppedBy === "auth"
		);
	}

	finish(): FetchRegionalResult {
		this.result.ok = this.result.stoppedBy === null && this.failures === 0;
		return this.result;
	}

	private stop(step: Step | "all", reason: "quota" | "auth" | "budget") {
		for (const each of ["list", "info", "stations"] as const) {
			if (step === "all" || step === each) {
				this.stopped[each] = true;
			}
		}
		const current = this.result.stoppedBy;
		// 한도·인증 실패가 예산 소진보다 먼저 보이게 한다.
		if (current === null || (current === "budget" && reason !== "budget")) {
			this.result.stoppedBy = reason;
		}
	}

	private urlFor(step: Step, id: string): string {
		const { key, source } = this.options;
		if (source === "gbis") {
			if (step === "list") {
				return gbisUrl("getBusRouteListv2", { keyword: id }, key);
			}
			const operation =
				step === "info" ? "getBusRouteInfoItemv2" : "getBusRouteStationListv2";
			return gbisUrl(operation, { routeId: id }, key);
		}
		const city = TAGO_INCHEON_CITY_CODE;
		if (step === "list") {
			return tagoUrl(
				"getRouteNoList",
				{ numOfRows: TAGO_LIST_ROWS },
				key,
				city
			);
		}
		if (step === "info") {
			return tagoUrl("getRouteInfoIem", { routeId: id }, key, city);
		}
		return tagoUrl(
			"getRouteAcctoThrghSttnList",
			{ numOfRows: TAGO_STATION_ROWS, routeId: id },
			key,
			city
		);
	}

	/** 예산 안에서 한 번 부른다. 예산이 다 찼으면 undefined. */
	private async request(
		step: Step,
		id: string
	): Promise<string | null | undefined> {
		if (this.calls[step] >= this.budget) {
			this.stop(step, "budget");
			return undefined;
		}
		if (this.totalCalls > 0) {
			await this.sleep(BUS_REQUEST_DELAY_MS);
		}
		this.calls[step] += 1;
		this.totalCalls += 1;
		const fetchImpl = this.options.fetchImpl ?? fetch;
		try {
			const response = await fetchImpl(this.urlFor(step, id));
			return await response.text();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// 네트워크 오류 문구에 URL(키)이 들어 있을 수 있어 가려서만 남긴다.
			console.error(`${step} ${id}: ${maskKey(message, this.options.key)}`);
			return null;
		}
	}

	/** 한 번 불러 응답을 분류한다. 호출하지 못했으면 undefined. */
	async call(
		step: Step,
		id: string,
		parse: (json: unknown) => RegionalEnvelope<unknown>
	): Promise<CallOutcome | undefined> {
		const text = await this.request(step, id);
		if (text === undefined) {
			return undefined;
		}
		if (text === null) {
			return { ok: false, reason: "temporary" };
		}
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			return { ok: false, reason: "temporary" };
		}
		const parsed = parse(json);
		if (parsed.ok) {
			return { ok: true, reason: null, text };
		}
		if (parsed.reason === "no-data") {
			// 결과 없음은 되풀이해도 같아서 본문을 남겨 다음 실행이 다시 부르지 않게 한다.
			return { ok: true, reason: null, text };
		}
		return { ok: false, reason: parsed.reason };
	}

	/** 실패 이유로 멈춤·실패 집계를 한다. 계속할 수 있으면 true. */
	handleFailure(reason: RegionalFailReason): boolean {
		if (reason === "quota") {
			// 한도는 오퍼레이션마다 따로지만 같은 키라 남은 호출을 아낀다.
			this.stop("all", "quota");
			return false;
		}
		if (reason === "auth") {
			this.stop("all", "auth");
			return false;
		}
		this.failures += 1;
		return true;
	}

	async save(step: Step, fileName: string, text: string): Promise<void> {
		const { dataDir, source } = this.options;
		await saveRaw(
			dataDir,
			STEP_SOURCE(source, step),
			fileName,
			new TextEncoder().encode(text)
		);
		this.result.fetched[step] += 1;
	}

	isStopped(step: Step): boolean {
		return this.stopped[step];
	}
}

function utcDate(date: Date): string {
	return date.toISOString().slice(0, DATE_LENGTH);
}

/** 7일 안에 받은 목록 원본을 가장 최근 날짜 폴더부터 찾는다. */
async function findFreshListRaw(
	dataDir: string,
	listSource: string,
	term: string,
	now: Date
): Promise<string | undefined> {
	let dirs: string[];
	try {
		dirs = await readdir(rawPath(dataDir, listSource, ""));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
	const fresh = dirs
		.filter((dir) => DATE_DIR_RE.test(dir))
		.filter(
			(dir) => now.getTime() - Date.parse(dir) <= LIST_FRESH_DAYS * DAY_MS
		)
		.sort()
		.reverse();
	for (const dir of fresh) {
		// biome-ignore lint/performance/noAwaitInLoops: 가장 최근 폴더부터 하나씩 확인한다
		const raw = await readRaw(dataDir, listSource, `${dir}/${term}.json`);
		if (raw) {
			return new TextDecoder().decode(raw.bytes);
		}
	}
	return undefined;
}

function listParser(
	source: RegionalSource
): (json: unknown) => RegionalEnvelope<RegionalRouteRow> {
	if (source === "gbis") {
		return parseGbisRouteList;
	}
	return (json) => parseTagoRouteList(json, TAGO_INCHEON_CITY_CODE);
}

/** 검색어별 목록을 받아(또는 원본에서 읽어) routeId로 합친다. 중간에 멈추면 undefined. */
async function loadRouteList(
	fetcher: RegionalFetcher,
	options: FetchRegionalOptions,
	today: string,
	now: Date
): Promise<{ complete: boolean; routes: RegionalRouteRow[] } | undefined> {
	const { dataDir, source } = options;
	const listSource = STEP_SOURCE(source, "list");
	const terms =
		options.terms ??
		(source === "gbis" ? GBIS_TERMS : [TAGO_INCHEON_CITY_CODE]);
	const parse = listParser(source);
	const byId = new Map<string, RegionalRouteRow>();
	let complete = true;
	for (const term of terms) {
		// biome-ignore lint/performance/noAwaitInLoops: 호출 사이에 쉬며 순서대로 부른다
		let text = await findFreshListRaw(dataDir, listSource, term, now);
		if (text === undefined) {
			const outcome = await fetcher.call("list", term, parse);
			if (outcome === undefined) {
				return undefined;
			}
			if (!outcome.ok) {
				if (fetcher.handleFailure(outcome.reason)) {
					complete = false;
					continue;
				}
				return undefined;
			}
			await fetcher.save("list", `${today}/${term}.json`, outcome.text);
			({ text } = outcome);
		}
		const parsed = parse(JSON.parse(text));
		if (parsed.ok) {
			for (const row of parsed.items) {
				byId.set(row.routeId, row);
			}
		}
	}
	return { complete, routes: [...byId.values()] };
}

function inScope(source: RegionalSource, row: RegionalRouteRow): boolean {
	return isInScopeRegionalRoute(source, row.routeTypeCode);
}

/** 노선 하나의 한 단계를 받는다. 한도·인증 실패로 전체를 멈춰야 하면 false. */
async function fetchStep(
	fetcher: RegionalFetcher,
	options: FetchRegionalOptions,
	step: "info" | "stations",
	routeId: string
): Promise<boolean> {
	const fileName = `${routeId}.json`;
	const existing = await readRaw(
		options.dataDir,
		STEP_SOURCE(options.source, step),
		fileName
	);
	if (existing || fetcher.isStopped(step)) {
		return true;
	}
	const outcome = await fetcher.call(
		step,
		routeId,
		detailParsers(options.source)[step]
	);
	if (outcome === undefined) {
		return true;
	}
	if (!outcome.ok) {
		return fetcher.handleFailure(outcome.reason);
	}
	await fetcher.save(step, fileName, outcome.text);
	return true;
}

async function fetchRouteDetails(
	fetcher: RegionalFetcher,
	options: FetchRegionalOptions,
	routes: RegionalRouteRow[]
): Promise<void> {
	for (const route of routes) {
		if (!(inScope(options.source, route) && SAFE_ID_RE.test(route.routeId))) {
			continue;
		}
		// biome-ignore lint/performance/noAwaitInLoops: 호출 사이에 쉬며 순서대로 부른다
		const infoOk = await fetchStep(fetcher, options, "info", route.routeId);
		const stationsOk =
			infoOk && (await fetchStep(fetcher, options, "stations", route.routeId));
		if (!(infoOk && stationsOk)) {
			return;
		}
		if (fetcher.isStopped("info") && fetcher.isStopped("stations")) {
			return;
		}
	}
}

function detailParsers(source: RegionalSource): {
	info: (json: unknown) => RegionalEnvelope<unknown>;
	stations: (json: unknown) => RegionalEnvelope<unknown>;
} {
	if (source === "gbis") {
		return { info: parseGbisRouteInfo, stations: parseGbisRouteStations };
	}
	return {
		info: (json) => parseTagoRouteInfo(json, TAGO_INCHEON_CITY_CODE),
		stations: (json) => parseTagoRouteStations(json, TAGO_INCHEON_CITY_CODE),
	};
}

/**
 * 경기(GBIS)·인천(TAGO) 노선 목록, 노선 정보, 경유 정류장을 받아 원본으로 남긴다.
 * 이미 받은 원본은 다시 부르지 않으므로 한도로 멈춰도 다음 실행이 이어 받는다.
 */
export async function fetchRegionalRoutes(
	options: FetchRegionalOptions
): Promise<FetchRegionalResult> {
	const now = (options.now ?? (() => new Date()))();
	const today = utcDate(now);
	const fetcher = new RegionalFetcher(options);
	const list = await loadRouteList(fetcher, options, today, now);
	if (list === undefined) {
		return fetcher.finish();
	}
	const { complete, routes } = list;
	fetcher.result.routes = routes.length;
	// 검색어가 하나라도 빠진 목록을 합친 목록으로 남기면, build가 그 검색어의 노선을 모른 채
	// 적재 비율을 재서 빠진 노선이 숨는다. 빠졌으면 이전의 온전한 목록을 그대로 둔다.
	if (complete) {
		const merged = rawPath(
			options.dataDir,
			STEP_SOURCE(options.source, "list"),
			`${today}/${REGIONAL_ROUTES_FILE}`
		);
		await mkdir(dirname(merged), { recursive: true });
		await writeFile(merged, `${JSON.stringify(routes)}\n`);
	}
	await fetchRouteDetails(fetcher, options, routes);
	return fetcher.finish();
}

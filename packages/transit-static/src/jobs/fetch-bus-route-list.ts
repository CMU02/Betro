import { readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { rawPath } from "../paths";
import {
	fetchBusRouteOperation,
	maskKey,
	parseBusEnvelope,
} from "../sources/seoul-bus-api";
import {
	type BusRouteListRow,
	mergeRouteLists,
	parseBusRouteList,
	ROUTE_LIST_SEARCH_TERMS,
} from "../sources/seoul-bus-route-list";

export const BUS_ROUTE_LIST_SOURCE = "bus-route-list";
export const ROUTES_FILE = "routes.json";
const FRESH_DAYS = 7;
const DAY_MS = 86_400_000;
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_LENGTH = 10;

export type RouteListStop =
	| "none"
	| "quota-exceeded"
	| "rate-limited"
	| "unauthorized";

export interface FetchBusRouteListOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
	key: string;
	now?: () => Date;
	terms?: readonly string[];
}

export interface FetchBusRouteListResult {
	calls: number;
	failed: string[];
	routes: BusRouteListRow[];
	stoppedBy: RouteListStop;
}

function utcDate(date: Date): string {
	return date.toISOString().slice(0, DATE_LENGTH);
}

function termFile(term: string): string {
	return `${term}.json`;
}

/** 7일 안(날짜 폴더 기준)에 받은 검색어 원본을 가장 최근 것부터 찾아 읽는다. */
async function findFreshRaw(
	dataDir: string,
	term: string,
	now: Date
): Promise<string | undefined> {
	const root = rawPath(dataDir, BUS_ROUTE_LIST_SOURCE, "");
	let dirs: string[] = [];
	try {
		dirs = await readdir(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
	const today = Date.parse(utcDate(now));
	const candidates = dirs
		.filter((dir) => DATE_DIR_RE.test(dir))
		.filter((dir) => today - Date.parse(dir) <= FRESH_DAYS * DAY_MS)
		.sort()
		.reverse();
	for (const dir of candidates) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: 최근 날짜부터 처음 찾은 파일을 쓴다
			return await readFile(join(root, dir, termFile(term)), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
	return undefined;
}

function rowsFromBody(bodyText: string): BusRouteListRow[] {
	const envelope = parseBusEnvelope(200, bodyText);
	return envelope.kind === "ok" ? parseBusRouteList(envelope.items) : [];
}

const STOP_BY_KIND = {
	"quota-exceeded": "quota-exceeded",
	"rate-limited": "rate-limited",
	unauthorized: "unauthorized",
} as const;

/**
 * 검색어마다 getBusRouteList를 한 번 부르고 합친 목록을 routes.json으로 남긴다.
 * 중간에 멈추거나 실패한 검색어가 있으면 routes.json은 쓰지 않는다(원본은 남아 재실행이 이어받는다).
 * 7일 안에 받은 검색어는 저장된 원본을 쓰고 다시 부르지 않는다.
 */
export async function fetchBusRouteList(
	options: FetchBusRouteListOptions
): Promise<FetchBusRouteListResult> {
	const { dataDir, key } = options;
	const now = options.now?.() ?? new Date();
	const dateDir = utcDate(now);
	const pages: BusRouteListRow[][] = [];
	const failed: string[] = [];
	let calls = 0;
	let stoppedBy: RouteListStop = "none";

	for (const term of options.terms ?? ROUTE_LIST_SEARCH_TERMS) {
		// biome-ignore lint/performance/noAwaitInLoops: 검색어를 순서대로 부르고 한도 응답에서 멈춘다
		const cached = await findFreshRaw(dataDir, term, now);
		if (cached !== undefined) {
			pages.push(rowsFromBody(cached));
			continue;
		}
		calls += 1;
		const { envelope, bodyText } = await fetchBusRouteOperation({
			busRouteId: term,
			fetchImpl: options.fetchImpl,
			key,
			operation: "getBusRouteList",
		});
		if (envelope.kind === "ok") {
			const path = rawPath(
				dataDir,
				BUS_ROUTE_LIST_SOURCE,
				join(dateDir, termFile(term))
			);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, bodyText);
			pages.push(parseBusRouteList(envelope.items));
			continue;
		}
		const detail = "detail" in envelope ? envelope.detail : envelope.kind;
		failed.push(maskKey(`${term}: ${envelope.kind} ${detail}`, key));
		if (envelope.kind in STOP_BY_KIND) {
			stoppedBy = STOP_BY_KIND[envelope.kind as keyof typeof STOP_BY_KIND];
			break;
		}
	}

	const routes = mergeRouteLists(pages);
	const complete = stoppedBy === "none" && failed.length === 0;
	if (complete && pages.length > 0) {
		const out = rawPath(
			dataDir,
			BUS_ROUTE_LIST_SOURCE,
			join(dateDir, ROUTES_FILE)
		);
		await mkdir(dirname(out), { recursive: true });
		await writeFile(out, JSON.stringify(routes));
	}
	console.log(
		maskKey(
			[
				`calls: ${calls}`,
				`routes: ${routes.length}`,
				`failed: ${failed.length}`,
				`stoppedBy: ${stoppedBy}`,
			].join("\n"),
			key
		)
	);
	return { calls, failed, routes, stoppedBy };
}

/** 가장 최근 `routes.json`. 없으면 null. */
export function latestRouteList(dataDir: string): BusRouteListRow[] | null {
	const root = rawPath(dataDir, BUS_ROUTE_LIST_SOURCE, "");
	let dirs: string[] = [];
	try {
		dirs = readdirSync(root);
	} catch {
		return null;
	}
	const sorted = dirs
		.filter((dir) => DATE_DIR_RE.test(dir))
		.sort()
		.reverse();
	for (const dir of sorted) {
		try {
			return JSON.parse(
				readFileSync(join(root, dir, ROUTES_FILE), "utf8")
			) as BusRouteListRow[];
		} catch {
			// 이 날짜에 routes.json이 없으면 이전 날짜로 간다.
		}
	}
	return null;
}

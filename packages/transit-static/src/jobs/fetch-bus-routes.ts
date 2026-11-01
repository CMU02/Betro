import { stat, utimes } from "node:fs/promises";
import { isInScopeRouteType } from "../bus/scope";
import { rawPath } from "../paths";
import { readRaw, saveRaw } from "../raw-store";
import {
	BUS_ROUTE_XLSX_SOURCE,
	type BusRouteListEntry,
	parseBusRouteRows,
	readBusRouteXlsx,
} from "../sources/bus-route-xlsx";
import {
	type BusEnvelope,
	type BusRouteOperation,
	fetchBusRouteOperation,
	maskKey,
	parseBusEnvelope,
	parseRouteStations,
} from "../sources/seoul-bus-api";
import { latestBusRouteXlsx } from "./fetch-bus-route-xlsx";

export const BUS_STATIONS_SOURCE = "bus-route-stations";
export const BUS_PATH_SOURCE = "bus-route-path";
/** 요청 간격(ms). 개발계정 한도 안에서 서버에 부담을 주지 않으려는 값. */
export const BUS_REQUEST_DELAY_MS = 100;
/** 오퍼레이션별 하루 한도 1,000건에서 여유를 둔 한 번 실행의 호출 상한. */
export const BUS_CALLS_PER_OPERATION_PER_RUN = 950;
const DEFAULT_MAX_AGE_DAYS = 7;
/** retryable·rate-limited 응답을 다시 시도하기 전 기다리는 시간(ms). 길이가 재시도 횟수다. */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000];
const DAY_MS = 86_400_000;

const OPERATIONS: readonly BusRouteOperation[] = [
	"getStaionByRoute",
	"getRoutePath",
];

const SOURCE_BY_OPERATION: Record<BusRouteOperation, string> = {
	getRoutePath: BUS_PATH_SOURCE,
	getStaionByRoute: BUS_STATIONS_SOURCE,
};

type StopReason = "quota-exceeded" | "unauthorized" | "budget";

// 결과에 남길 멈춤 이유가 여럿이면 더 심각한 쪽을 남긴다.
const STOP_SEVERITY: Record<StopReason, number> = {
	budget: 1,
	"quota-exceeded": 2,
	unauthorized: 3,
};

export interface FetchBusRoutesFailure {
	detail: string;
	kind: string;
	operation: BusRouteOperation;
	routeId: string;
}

export interface FetchBusRoutesResult {
	failed: FetchBusRoutesFailure[];
	fetched: Record<BusRouteOperation, number>;
	notFound: string[];
	outOfScope: number;
	routes: number;
	skippedFresh: Record<BusRouteOperation, number>;
	stoppedBy: StopReason | null;
}

export interface FetchBusRoutesOptions {
	callsPerOperation?: number;
	dataDir: string;
	delayMs?: number;
	fetchImpl?: typeof fetch;
	key: string;
	maxAgeDays?: number;
	now?: () => Date;
	/** 재시도 대기 시간 목록. 테스트에서 기다리지 않으려고 둔다. */
	retryDelaysMs?: readonly number[];
	/** 없으면 최신 OA-1095 엑셀에서 노선 목록을 읽는다. */
	routes?: BusRouteListEntry[];
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function fileName(routeId: string): string {
	return `${routeId}.json`;
}

async function loadRouteList(dataDir: string): Promise<BusRouteListEntry[]> {
	const latest = await latestBusRouteXlsx(dataDir);
	const rows = await readBusRouteXlsx(
		rawPath(dataDir, BUS_ROUTE_XLSX_SOURCE, latest.fileName)
	);
	const { routes, errors } = parseBusRouteRows(rows);
	if (errors.length > 0) {
		throw new Error(
			`bus route xlsx ${latest.fileName} invalid: ${errors.join("; ")}`
		);
	}
	return routes;
}

/** 저장된 원본의 수정 시각이 maxAgeDays 이내인지. 파일이 없으면 false. */
async function isFresh(
	path: string,
	maxAgeMs: number,
	now: Date
): Promise<boolean> {
	try {
		const info = await stat(path);
		return now.getTime() - info.mtimeMs <= maxAgeMs;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

/** 저장된 정류소 원본에서 routeType을 읽는다. 읽을 수 없으면 undefined. */
function readRouteType(bytes: Uint8Array): string | undefined {
	const envelope = parseBusEnvelope(200, new TextDecoder().decode(bytes));
	if (envelope.kind !== "ok") {
		return undefined;
	}
	const [first] = parseRouteStations(envelope.items).rows;
	return first?.routeType;
}

type StepOutcome = "available" | "missing" | "not-found" | "stop-all";

class BusRouteFetcher {
	readonly result: FetchBusRoutesResult;
	private readonly calls: Record<BusRouteOperation, number> = {
		getRoutePath: 0,
		getStaionByRoute: 0,
	};
	private readonly stopped: Record<BusRouteOperation, boolean> = {
		getRoutePath: false,
		getStaionByRoute: false,
	};
	private totalCalls = 0;
	private readonly options: Required<
		Omit<FetchBusRoutesOptions, "routes" | "fetchImpl">
	> & { fetchImpl?: typeof fetch };

	constructor(options: FetchBusRoutesOptions, routeCount: number) {
		this.options = {
			callsPerOperation:
				options.callsPerOperation ?? BUS_CALLS_PER_OPERATION_PER_RUN,
			dataDir: options.dataDir,
			delayMs: options.delayMs ?? BUS_REQUEST_DELAY_MS,
			fetchImpl: options.fetchImpl,
			key: options.key,
			maxAgeDays: options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS,
			now: options.now ?? (() => new Date()),
			retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
		};
		this.result = {
			failed: [],
			fetched: { getRoutePath: 0, getStaionByRoute: 0 },
			notFound: [],
			outOfScope: 0,
			routes: routeCount,
			skippedFresh: { getRoutePath: 0, getStaionByRoute: 0 },
			stoppedBy: null,
		};
	}

	get allStopped(): boolean {
		return OPERATIONS.every((operation) => this.stopped[operation]);
	}

	private stop(operation: BusRouteOperation | "all", reason: StopReason) {
		for (const op of OPERATIONS) {
			if (operation === "all" || op === operation) {
				this.stopped[op] = true;
			}
		}
		const current = this.result.stoppedBy;
		if (current === null || STOP_SEVERITY[reason] > STOP_SEVERITY[current]) {
			this.result.stoppedBy = reason;
		}
	}

	private fail(
		routeId: string,
		operation: BusRouteOperation,
		envelope: BusEnvelope
	) {
		this.result.failed.push({
			detail:
				"detail" in envelope
					? maskKey(envelope.detail, this.options.key)
					: envelope.kind,
			kind: envelope.kind,
			operation,
			routeId,
		});
	}

	/** 예산 안에서 한 번 부른다. 예산이 다 찼으면 undefined. */
	private async callOnce(
		operation: BusRouteOperation,
		routeId: string
	): Promise<{ envelope: BusEnvelope; bodyText: string } | undefined> {
		if (this.calls[operation] >= this.options.callsPerOperation) {
			this.stop(operation, "budget");
			return undefined;
		}
		if (this.totalCalls > 0 && this.options.delayMs > 0) {
			await sleep(this.options.delayMs);
		}
		this.calls[operation] += 1;
		this.totalCalls += 1;
		return await fetchBusRouteOperation({
			busRouteId: routeId,
			fetchImpl: this.options.fetchImpl,
			key: this.options.key,
			operation,
		});
	}

	/** retryable·rate-limited는 백오프하며 다시 부른다. 예산이 다 차면 undefined. */
	private async callWithRetry(
		operation: BusRouteOperation,
		routeId: string
	): Promise<{ envelope: BusEnvelope; bodyText: string } | undefined> {
		const delays = this.options.retryDelaysMs;
		let response = await this.callOnce(operation, routeId);
		for (const delay of delays) {
			const kind = response?.envelope.kind;
			if (kind !== "retryable" && kind !== "rate-limited") {
				break;
			}
			// biome-ignore lint/performance/noAwaitInLoops: 재시도는 앞 시도의 결과를 보고 순서대로 한다
			await sleep(delay);
			const next = await this.callOnce(operation, routeId);
			if (!next) {
				// 재시도 중 예산이 다 차면 마지막 응답을 실패로 남긴다.
				break;
			}
			response = next;
		}
		return response;
	}

	/**
	 * 한 오퍼레이션의 원본을 확보한다. 신선한 파일이 있으면 부르지 않는다.
	 * 오퍼레이션이 멈췄거나 받지 못했으면 이전에 받은 (오래된) 파일이 있을 때만 "available".
	 */
	async ensure(
		operation: BusRouteOperation,
		routeId: string
	): Promise<StepOutcome> {
		const { dataDir, maxAgeDays, now } = this.options;
		const source = SOURCE_BY_OPERATION[operation];
		const path = rawPath(dataDir, source, fileName(routeId));
		if (await isFresh(path, maxAgeDays * DAY_MS, now())) {
			this.result.skippedFresh[operation] += 1;
			return "available";
		}
		const existing = async (): Promise<StepOutcome> =>
			(await readRaw(dataDir, source, fileName(routeId)))
				? "available"
				: "missing";
		if (this.stopped[operation]) {
			return await existing();
		}
		const response = await this.callWithRetry(operation, routeId);
		if (!response) {
			return await existing();
		}
		const { envelope, bodyText } = response;
		switch (envelope.kind) {
			case "ok": {
				// 응답 본문을 그대로 저장한다. 내용이 같아 덮어쓰지 않았으면 수정 시각만 갱신해
				// 다음 실행에서 신선한 파일로 본다.
				const saved = await saveRaw(
					dataDir,
					source,
					fileName(routeId),
					new TextEncoder().encode(bodyText)
				);
				if (saved.unchanged) {
					const touchedAt = now();
					await utimes(saved.path, touchedAt, touchedAt);
				}
				this.result.fetched[operation] += 1;
				return "available";
			}
			case "route-not-found":
				if (!this.result.notFound.includes(routeId)) {
					this.result.notFound.push(routeId);
				}
				return "not-found";
			case "unauthorized":
				this.fail(routeId, operation, envelope);
				this.stop("all", "unauthorized");
				return "stop-all";
			case "quota-exceeded":
				this.fail(routeId, operation, envelope);
				this.stop(operation, "quota-exceeded");
				return await existing();
			default:
				this.fail(routeId, operation, envelope);
				return await existing();
		}
	}

	async fetchRoute(routeId: string): Promise<void> {
		const stations = await this.ensure("getStaionByRoute", routeId);
		if (stations !== "available") {
			return;
		}
		const raw = await readRaw(
			this.options.dataDir,
			BUS_STATIONS_SOURCE,
			fileName(routeId)
		);
		const routeType = raw ? readRouteType(raw.bytes) : undefined;
		if (routeType === undefined) {
			this.result.failed.push({
				detail: "stations response has no valid rows to read routeType",
				kind: "error",
				operation: "getStaionByRoute",
				routeId,
			});
			return;
		}
		if (!isInScopeRouteType(routeType)) {
			this.result.outOfScope += 1;
			return;
		}
		await this.ensure("getRoutePath", routeId);
	}
}

function printSummary(result: FetchBusRoutesResult, key: string) {
	const lines = [
		`routes: ${result.routes}`,
		...OPERATIONS.map(
			(operation) =>
				`${operation}: fetched ${result.fetched[operation]}, skipped fresh ${result.skippedFresh[operation]}`
		),
		`outOfScope: ${result.outOfScope}`,
		`notFound: ${result.notFound.length}`,
		`failed: ${result.failed.length}`,
		`stoppedBy: ${result.stoppedBy ?? "none"}`,
	];
	console.log(maskKey(lines.join("\n"), key));
}

/**
 * 노선마다 getStaionByRoute 원본을 받고, 범위 안 노선이면 getRoutePath 원본을 받는다.
 * 이미 받은 신선한 원본은 다시 부르지 않으므로, 한도로 멈춘 뒤 다시 실행하면 남은 노선부터 이어 받는다.
 */
export async function fetchBusRoutes(
	options: FetchBusRoutesOptions
): Promise<FetchBusRoutesResult> {
	const list = options.routes ?? (await loadRouteList(options.dataDir));
	const routeIds = [...new Set(list.map((entry) => entry.routeId))].sort(
		(a, b) => (a < b ? -1 : Number(a > b))
	);
	const fetcher = new BusRouteFetcher(options, routeIds.length);
	for (const routeId of routeIds) {
		if (fetcher.allStopped) {
			break;
		}
		// biome-ignore lint/performance/noAwaitInLoops: 오퍼레이션별 하루 한도 때문에 노선을 순서대로 부른다
		await fetcher.fetchRoute(routeId);
	}
	const { result } = fetcher;
	printSummary(result, options.key);
	return result;
}

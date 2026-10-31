import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readRaw, saveRaw } from "../raw-store";
import { fetchStationSearchRaw } from "../sources/seoul-open-api";
import { parseStationRows, readStationXlsx } from "../sources/station-xlsx";

const XLSX_SOURCE = "oa-12764-station-xlsx";
const SEARCH_SOURCE = "oa-121-station-search";
const XLSX_NAME = /^stations-seq(\d+)\.xlsx$/;
const REQUEST_DELAY_MS = 200;

export interface FetchStationSearchOptions {
	dataDir: string;
	delayMs?: number;
	fetchImpl?: typeof fetch;
	key: string;
}

async function latestXlsxPath(dataDir: string): Promise<string> {
	const dir = join(dataDir, "raw", XLSX_SOURCE);
	const names = await readdir(dir);
	const found = names
		.map((n) => XLSX_NAME.exec(n))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => ({ name: m[0], seq: Number(m[1]) }))
		.sort((a, b) => b.seq - a.seq);
	const [latest] = found;
	if (!latest) {
		throw new Error(`no station xlsx in ${dir}; run fetch:station-xlsx first`);
	}
	return join(dir, latest.name);
}

export async function fetchStationSearch({
	dataDir,
	key,
	fetchImpl = fetch,
	delayMs = REQUEST_DELAY_MS,
}: FetchStationSearchOptions) {
	const { rows } = parseStationRows(
		await readStationXlsx(await latestXlsxPath(dataDir))
	);
	const names = [
		...new Set(rows.map((r) => r.nameRaw).filter((n) => n !== "")),
	];
	let fetched = 0;
	let skipped = 0;
	for (const name of names) {
		const fileName = `${name}.json`;
		// 요청 사이 간격과 재개 가능성을 위해 의도적으로 순차 처리한다.
		// biome-ignore lint/performance/noAwaitInLoops: sequential by design (rate limit)
		if (await readRaw(dataDir, SEARCH_SOURCE, fileName)) {
			skipped += 1;
			continue;
		}
		const result = await fetchStationSearchRaw(key, name, fetchImpl);
		if (!result.ok) {
			throw new Error(
				`station search failed for ${name}: ${result.code} ${result.message}`
			);
		}
		await saveRaw(
			dataDir,
			SEARCH_SOURCE,
			fileName,
			new TextEncoder().encode(JSON.stringify({ rows: result.rows }, null, 2))
		);
		fetched += 1;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	console.log(
		`names: ${names.length}\nfetched: ${fetched}\nskipped: ${skipped}`
	);
	return { fetched, skipped, total: names.length };
}

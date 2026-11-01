import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { saveRaw } from "../raw-store";
import {
	BUS_ROUTE_XLSX_SOURCE,
	busRouteXlsxUrl,
} from "../sources/bus-route-xlsx";
import { isZip } from "./fetch-station-xlsx";

const XLSX_NAME = /^routes-seq(\d+)\.xlsx$/;

export interface FetchBusRouteXlsxOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
	seq: number;
}

export async function fetchBusRouteXlsx({
	dataDir,
	seq,
	fetchImpl = fetch,
}: FetchBusRouteXlsxOptions) {
	const url = busRouteXlsxUrl(seq);
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(
			`bus route xlsx download failed: ${response.status} ${url}`
		);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (!isZip(bytes)) {
		const contentType = response.headers.get("content-type") ?? "unknown";
		throw new Error(
			`bus route xlsx response is not a valid xlsx (zip) file: content-type=${contentType}, ${bytes.length} bytes, ${url}`
		);
	}
	const result = await saveRaw(
		dataDir,
		BUS_ROUTE_XLSX_SOURCE,
		`routes-seq${seq}.xlsx`,
		bytes
	);
	console.log(
		`path: ${result.path}\nsha256: ${result.sha256}\nunchanged: ${result.unchanged}`
	);
	return result;
}

/** 받아 둔 노선 엑셀 중 seq가 가장 큰 파일. */
export async function latestBusRouteXlsx(
	dataDir: string
): Promise<{ fileName: string; seq: number }> {
	const dir = join(dataDir, "raw", BUS_ROUTE_XLSX_SOURCE);
	let names: string[] = [];
	try {
		names = await readdir(dir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
	const found = names
		.map((name) => XLSX_NAME.exec(name))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => ({ fileName: m[0], seq: Number(m[1]) }))
		.sort((a, b) => b.seq - a.seq);
	const [latest] = found;
	if (!latest) {
		throw new Error(
			`no bus route xlsx in ${dir}; run fetch:bus-route-xlsx first`
		);
	}
	return latest;
}

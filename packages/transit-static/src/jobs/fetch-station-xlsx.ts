import { saveRaw } from "../raw-store";
import { stationXlsxUrl } from "../sources/station-xlsx";

export interface FetchStationXlsxOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
	seq: number;
}

export async function fetchStationXlsx({
	dataDir,
	seq,
	fetchImpl = fetch,
}: FetchStationXlsxOptions) {
	const url = stationXlsxUrl(seq);
	const response = await fetchImpl(url);
	if (!response.ok) {
		throw new Error(`station xlsx download failed: ${response.status} ${url}`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	const result = await saveRaw(
		dataDir,
		"oa-12764-station-xlsx",
		`stations-seq${seq}.xlsx`,
		bytes
	);
	console.log(
		`path: ${result.path}\nsha256: ${result.sha256}\nunchanged: ${result.unchanged}`
	);
	return result;
}

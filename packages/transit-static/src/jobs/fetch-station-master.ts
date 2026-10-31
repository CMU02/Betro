import { saveRaw } from "../raw-store";
import { fetchStationMaster as fetchMasterRows } from "../sources/seoul-open-api";

export interface FetchStationMasterOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
	key: string;
}

export async function fetchStationMaster({
	dataDir,
	key,
	fetchImpl = fetch,
}: FetchStationMasterOptions) {
	const result = await fetchMasterRows(key, fetchImpl);
	if (!result.ok) {
		throw new Error(
			`station master fetch failed: ${result.code} ${result.message}`
		);
	}
	const bytes = new TextEncoder().encode(
		JSON.stringify({ rows: result.rows }, null, 2)
	);
	const saved = await saveRaw(
		dataDir,
		"oa-21232-station-master",
		"station-master.json",
		bytes
	);
	console.log(
		`rows: ${result.rows.length}\npath: ${saved.path}\nsha256: ${saved.sha256}\nunchanged: ${saved.unchanged}`
	);
	return saved;
}

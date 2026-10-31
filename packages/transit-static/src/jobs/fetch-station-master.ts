import { saveRaw } from "../raw-store";
import {
	fetchStationMasterRaw,
	normalizeStationMasterRows,
} from "../sources/seoul-open-api";

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
	const result = await fetchStationMasterRaw(key, fetchImpl);
	if (!result.ok) {
		throw new Error(
			`station master fetch failed: ${result.code} ${result.message}`
		);
	}
	const bytes = new TextEncoder().encode(
		JSON.stringify({ rows: result.rows }, null, 2)
	);
	// 원본 행을 그대로 먼저 저장한다. 정규화/검증은 저장 이후에 한다.
	const saved = await saveRaw(
		dataDir,
		"oa-21232-station-master",
		"station-master.json",
		bytes
	);
	const normalized = normalizeStationMasterRows(result.rows);
	if (!normalized.ok) {
		throw new Error(
			`station master rows invalid (raw saved at ${saved.path}): ${normalized.code} ${normalized.message}`
		);
	}
	console.log(
		`rows: ${result.rows.length}\npath: ${saved.path}\nsha256: ${saved.sha256}\nunchanged: ${saved.unchanged}`
	);
	return saved;
}

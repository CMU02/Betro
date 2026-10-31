import { saveRaw } from "../raw-store";
import { stationXlsxUrl } from "../sources/station-xlsx";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;

function isZip(bytes: Uint8Array): boolean {
	return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

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
	if (!isZip(bytes)) {
		const contentType = response.headers.get("content-type") ?? "unknown";
		throw new Error(
			`station xlsx response is not a valid xlsx (zip) file: content-type=${contentType}, ${bytes.length} bytes, ${url}`
		);
	}
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

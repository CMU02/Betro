import {
	fetchSeoulMetroCsv,
	SEOUL_METRO_CSV_URL,
} from "../sources/seoul-metro-csv";

export interface FetchTimetableSourcesOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
	/** 판이 바뀌면 timetable-sources.json의 값으로 덮어쓴다. */
	seoulMetroCsvUrl?: string;
}

/** 키 없이 받을 수 있는 시간표 원본을 내려받는다. 지금은 서울교통공사 CSV만. */
export async function fetchTimetableSources({
	dataDir,
	fetchImpl = fetch,
	seoulMetroCsvUrl = SEOUL_METRO_CSV_URL,
}: FetchTimetableSourcesOptions) {
	const seoulMetro = await fetchSeoulMetroCsv(
		dataDir,
		seoulMetroCsvUrl,
		fetchImpl
	);
	console.log(
		`seoul-metro-csv\n  file: ${seoulMetro.fileName}\n  path: ${seoulMetro.path}\n  sha256: ${seoulMetro.sha256}\n  unchanged: ${seoulMetro.unchanged}`
	);
	return { seoulMetro };
}

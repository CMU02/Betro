import { fetchKricFile, KRIC_FILE_URL } from "../sources/kric-file";
import {
	fetchSeoulMetroCsv,
	SEOUL_METRO_CSV_URL,
} from "../sources/seoul-metro-csv";

export interface FetchTimetableSourcesOptions {
	dataDir: string;
	fetchImpl?: typeof fetch;
	/** KRIC 전체 도시철도 운행정보 파일(id=900). */
	kricFileUrl?: string;
	/** 판이 바뀌면 timetable-sources.json의 값으로 덮어쓴다. */
	seoulMetroCsvUrl?: string;
}

/** 키 없이 받을 수 있는 시간표 원본을 내려받는다. 서울교통공사 CSV와 KRIC id=900 xlsx. */
export async function fetchTimetableSources({
	dataDir,
	fetchImpl = fetch,
	seoulMetroCsvUrl = SEOUL_METRO_CSV_URL,
	kricFileUrl = KRIC_FILE_URL,
}: FetchTimetableSourcesOptions) {
	const seoulMetro = await fetchSeoulMetroCsv(
		dataDir,
		seoulMetroCsvUrl,
		fetchImpl
	);
	console.log(
		`seoul-metro-csv\n  file: ${seoulMetro.fileName}\n  path: ${seoulMetro.path}\n  sha256: ${seoulMetro.sha256}\n  unchanged: ${seoulMetro.unchanged}`
	);
	const kric = await fetchKricFile(dataDir, kricFileUrl, fetchImpl);
	console.log(
		`kric-timetable
  file: ${kric.fileName}
  path: ${kric.path}
  sha256: ${kric.sha256}
  unchanged: ${kric.unchanged}`
	);
	return { kric, seoulMetro };
}

import { LINES, type LineKey } from "../lines";
import { saveRaw } from "../raw-store";
import {
	parseRealtimePosition,
	SAMPLE_POSITION_URL,
} from "../realtime/position-parser";

const CALL_INTERVAL_MS = 200;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const NON_DIGIT = /\D/g;

export interface RealtimeSampleResult {
	code: string;
	lineKey: LineKey;
	rows: number;
}

/** KST 기준 yyyymmddHHMM. */
function stamp(now: Date): string {
	return new Date(now.getTime() + KST_OFFSET_MS)
		.toISOString()
		.slice(0, 16)
		.replace(NON_DIGIT, "");
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/** sample 키 경로로 19노선을 순차 호출해 원본을 저장한다. 실패 봉투도 형식 표본으로 저장한다. */
export async function fetchRealtimeSample(
	dataDir: string,
	fetchImpl: typeof fetch = fetch,
	intervalMs = CALL_INTERVAL_MS
): Promise<RealtimeSampleResult[]> {
	const results: RealtimeSampleResult[] = [];
	const time = stamp(new Date());
	for (const line of LINES) {
		if (results.length > 0) {
			// biome-ignore lint/performance/noAwaitInLoops: 호출 간격 200ms를 지키려면 순차 호출이어야 한다
			await sleep(intervalMs);
		}
		const response = await fetchImpl(SAMPLE_POSITION_URL(line.nameKo));
		const bytes = new Uint8Array(await response.arrayBuffer());
		await saveRaw(
			dataDir,
			"realtime-sample",
			`${line.lineKey}-${time}.json`,
			bytes
		);
		let parsed: ReturnType<typeof parseRealtimePosition>;
		try {
			parsed = parseRealtimePosition(
				JSON.parse(new TextDecoder().decode(bytes))
			);
		} catch {
			parsed = { code: "MALFORMED", message: "not json", ok: false };
		}
		results.push({
			code: parsed.ok ? "INFO-000" : parsed.code,
			lineKey: line.lineKey,
			rows: parsed.ok ? parsed.rows.length : 0,
		});
	}
	for (const r of results) {
		console.log(`${r.lineKey}\t${r.rows}\t${r.code}`);
	}
	return results;
}

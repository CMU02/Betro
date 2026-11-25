import { localParts } from "@Betro/commute/calendar";
import type { Database } from "@Betro/db";
import { commuteSession } from "@Betro/db/schema/commute";
import { lt } from "drizzle-orm";

/** 출퇴근 안내 기록(세션 행, 정확도 기록·요약, 일일 보고)을 남기는 날 수. 개인정보 처리방침과 같아야 한다. */
export const SESSION_RECORD_KEEP_DAYS = 90;

const DAY_MS = 86_400_000;
/** 키가 `<prefix><YYYY-MM-DD>`로 시작하는 R2 위치. */
const DATED_PREFIXES = [
	"commute/records/",
	"commute/summaries/",
	"commute/reports/",
] as const;
const DATE_LENGTH = "YYYY-MM-DD".length;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** R2 delete 한 번에 넘길 수 있는 키 수. */
const DELETE_BATCH = 1000;

/** R2 버킷 중 정리에 쓰는 부분. Workers `R2Bucket`이 그대로 맞는다. */
export interface RecordBucket {
	delete: (keys: string[]) => Promise<void>;
	list: (options: { cursor?: string; prefix: string }) => Promise<{
		cursor?: string;
		objects: { key: string }[];
		truncated: boolean;
	}>;
}

/** 이 서비스일보다 앞선 기록을 지운다. 기준일 자체는 남긴다. */
export function recordCutoffDate(now: number, timezone: string): string {
	return localParts(now - SESSION_RECORD_KEEP_DAYS * DAY_MS, timezone).date;
}

/** 기준일보다 앞선 서비스일의 세션 행을 지우고 지운 수를 돌려준다. */
export async function pruneSessionRows(
	db: Database,
	cutoffDate: string
): Promise<number> {
	const deleted = await db
		.delete(commuteSession)
		.where(lt(commuteSession.serviceDate, cutoffDate))
		.returning({ id: commuteSession.id });
	return deleted.length;
}

/** 기준일보다 앞선 날짜의 기록·요약·일일 보고 객체를 지우고 지운 수를 돌려준다. */
export async function pruneSessionBlobs(
	bucket: RecordBucket,
	cutoffDate: string
): Promise<number> {
	let count = 0;
	for (const prefix of DATED_PREFIXES) {
		const expired: string[] = [];
		let cursor: string | undefined;
		do {
			// biome-ignore lint/performance/noAwaitInLoops: 목록은 커서를 따라 차례로 받는다
			const page = await bucket.list({ cursor, prefix });
			for (const { key } of page.objects) {
				const date = key.slice(prefix.length, prefix.length + DATE_LENGTH);
				if (DATE_PATTERN.test(date) && date < cutoffDate) {
					expired.push(key);
				}
			}
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor !== undefined);
		for (let start = 0; start < expired.length; start += DELETE_BATCH) {
			// biome-ignore lint/performance/noAwaitInLoops: R2 delete는 1000개씩 나눠 보낸다
			await bucket.delete(expired.slice(start, start + DELETE_BATCH));
		}
		count += expired.length;
	}
	return count;
}

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReportBody {
	markdown: string;
	summary: Record<string, unknown>;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** UTC 기준 `YYYYMMDDTHHmmss`. 실행 환경의 시간대와 무관하게 같은 이름이 나오도록 UTC를 쓴다. */
function reportStamp(now: Date): string {
	const date = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`;
	const time = `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}`;
	return `${date}T${time}`;
}

/** `<dataDir>/reports/<job>/<YYYYMMDDTHHmmss>.json|.md`에 요약(JSON)과 사람이 읽는 보고서(Markdown)를 쓴다. */
export async function writeReport(
	dataDir: string,
	job: string,
	body: ReportBody,
	now: Date = new Date()
): Promise<{ jsonPath: string; mdPath: string }> {
	const dir = join(dataDir, "reports", job);
	await mkdir(dir, { recursive: true });
	const stamp = reportStamp(now);
	const jsonPath = join(dir, `${stamp}.json`);
	const mdPath = join(dir, `${stamp}.md`);
	await writeFile(jsonPath, `${JSON.stringify(body.summary, null, 2)}\n`);
	await writeFile(mdPath, body.markdown);
	return { jsonPath, mdPath };
}

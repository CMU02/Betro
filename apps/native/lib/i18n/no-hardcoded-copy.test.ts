import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";

const APP_ROOT = join(import.meta.dir, "..", "..");
const SOURCE_PATTERNS = [
	"app/**/*.tsx",
	"components/**/*.{ts,tsx}",
	"lib/**/*.{ts,tsx}",
	"contexts/**/*.tsx",
];
const EXCLUDED_FILE = /(\.test\.tsx?$)|(^lib\/i18n\/messages-ko\.ts$)/;
/** 블록 주석. JSX 중괄호 안의 블록 주석도 여기에 걸린다. 줄 수를 지키도록 줄바꿈은 남긴다. */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** 줄 주석. URL의 `://`는 앞 글자가 `:`라서 남는다. */
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;
const HANGUL = /[가-힣]/;

/** 주석을 뺀 코드에서 한글이 있는 줄을 `파일:줄: 내용`으로 돌려준다. */
function findHangulLines(file: string, source: string): string[] {
	const code = source
		.replace(BLOCK_COMMENT, (comment) => comment.replace(/[^\n]/g, " "))
		.replace(LINE_COMMENT, "$1");
	const found: string[] = [];
	for (const [index, line] of code.split("\n").entries()) {
		if (HANGUL.test(line)) {
			found.push(`${file}:${index + 1}: ${line.trim()}`);
		}
	}
	return found;
}

test("detector flags code but not comments", () => {
	expect(findHangulLines("a.ts", 'const a = "지도"; // 지도')).toHaveLength(1);
	expect(findHangulLines("a.ts", "// 지도\n/* 지도 */")).toHaveLength(0);
	expect(
		findHangulLines("a.tsx", "<View>{/* 지도 */}</View>\nconst b = 1;")
	).toHaveLength(0);
});

test("screens and components contain no hard-coded Korean copy", async () => {
	const files = SOURCE_PATTERNS.flatMap((pattern) =>
		Array.from(new Glob(pattern).scanSync(APP_ROOT))
	).filter((file) => !EXCLUDED_FILE.test(file));
	const sources = await Promise.all(
		files.map((file) => readFile(join(APP_ROOT, file), "utf8"))
	);
	const found = files.flatMap((file, index) =>
		findHangulLines(file, sources[index] ?? "")
	);
	expect(found.sort()).toEqual([]);
});

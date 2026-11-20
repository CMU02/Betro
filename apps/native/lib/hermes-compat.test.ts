import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";

const APP_ROOT = join(import.meta.dir, "..");
const SOURCE_PATTERNS = [
	"app/**/*.tsx",
	"components/**/*.{ts,tsx}",
	"lib/**/*.{ts,tsx}",
	"contexts/**/*.tsx",
];
const TEST_FILE = /\.test\.tsx?$/;
/**
 * 기기의 Hermes에 없는 ES2023 배열 메서드. bun 테스트는 통과해도 S20(Android)에서
 * "undefined is not a function"으로 화면이 멈췄다(2026-11-20 지도 실기기 확인).
 * 정렬은 `[...list].sort()`, 뒤에서 찾기는 직접 반복으로 쓴다.
 */
const UNSUPPORTED_ARRAY_METHOD =
	/\.(toSorted|toReversed|toSpliced|findLast|findLastIndex)\(/;

test("app code avoids array methods the device Hermes lacks", async () => {
	const files = SOURCE_PATTERNS.flatMap((pattern) =>
		Array.from(new Glob(pattern).scanSync(APP_ROOT))
	).filter((file) => !TEST_FILE.test(file));
	const sources = await Promise.all(
		files.map((file) => readFile(join(APP_ROOT, file), "utf8"))
	);
	const found = files.flatMap((file, index) =>
		(sources[index] ?? "")
			.split("\n")
			.flatMap((line, lineIndex) =>
				UNSUPPORTED_ARRAY_METHOD.test(line)
					? [`${file}:${lineIndex + 1}: ${line.trim()}`]
					: []
			)
	);
	expect(found.sort()).toEqual([]);
});

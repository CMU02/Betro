import { expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { lockStrings } from "./lock-strings";

const STRINGS_PATH = join(
	import.meta.dir,
	"..",
	"..",
	"targets",
	"commute-activity",
	"ko.lproj",
	"Localizable.strings"
);

/** `"key" = "value";` 한 줄. 값 안의 `\"`와 `\\`도 읽는다. */
const ENTRY = /^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)";$/;
const ESCAPE = /\\(.)/g;
const COMMENT_OR_BLANK = /^(\/\*.*\*\/|\/\/.*|)$/;

function unescapeStrings(text: string): string {
	return text.replace(ESCAPE, (_match, char: string) =>
		char === "n" ? "\n" : char
	);
}

/** `.strings` 파일을 키 → 값으로 읽는다. 읽지 못하는 줄이 있으면 던진다. */
function parseStrings(source: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		if (COMMENT_OR_BLANK.test(line)) {
			continue;
		}
		const match = ENTRY.exec(line);
		if (!match) {
			throw new Error(`Unreadable Localizable.strings line: ${line}`);
		}
		const key = unescapeStrings(match[1] ?? "");
		if (key in result) {
			throw new Error(`Duplicate Localizable.strings key: ${key}`);
		}
		result[key] = unescapeStrings(match[2] ?? "");
	}
	return result;
}

it("the widget strings match commute.lock.* in messages-ko.ts", async () => {
	const strings = parseStrings(await readFile(STRINGS_PATH, "utf8"));
	expect(strings).toEqual(lockStrings());
});

it("lockStrings flattens every commute.lock key", () => {
	const strings = lockStrings();
	expect(strings["commute.lock.status.ride"]).toBe("하차까지 {n}정거장");
	expect(strings["commute.lock.nextLeg.more"]).toBe("외 {n}구간");
	expect(strings["commute.lock.header.fallback"]).toBe("출퇴근");
	for (const key of Object.keys(strings)) {
		expect(key.startsWith("commute.lock.")).toBe(true);
	}
});

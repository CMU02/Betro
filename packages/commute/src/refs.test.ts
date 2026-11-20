import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lineRef, parseRef, stopRef } from "./refs";

const SESSION_DIR = join(import.meta.dir, "session");
/** 출처 이름. `sources/`와 `refs.ts` 밖의 세션 로직에는 나오지 않는다(2-C 규칙). */
const SOURCE_NAME = /seoul-|gbis|tago/i;

describe("refs", () => {
	test("parses a source-qualified id", () => {
		expect(parseRef("seoul-bus:100100290")).toEqual({
			id: "100100290",
			source: "seoul-bus",
		});
		expect(parseRef("seoul-subway:line2")).toEqual({
			id: "line2",
			source: "seoul-subway",
		});
	});

	test("keeps colons inside the id", () => {
		expect(parseRef("seoul-bus:a:b").id).toBe("a:b");
	});

	test("parses GBIS and TAGO ids", () => {
		expect(parseRef("gbis:234001243")).toEqual({
			id: "234001243",
			source: "gbis",
		});
		expect(parseRef("tago:ICB165000012")).toEqual({
			id: "ICB165000012",
			source: "tago",
		});
	});

	test("rejects unknown source, empty id and missing prefix", () => {
		expect(() => parseRef("busan-bus:GGB1")).toThrow(Error);
		expect(() => parseRef("gbis:")).toThrow(Error);
		expect(() => parseRef("seoul-bus:")).toThrow(Error);
		expect(() => parseRef("100100290")).toThrow(Error);
		expect(() => parseRef(":x")).toThrow(Error);
	});

	test("builds refs", () => {
		expect(lineRef("seoul-bus", "100100290")).toBe("seoul-bus:100100290");
		expect(stopRef("seoul-subway", "1002000222")).toBe(
			"seoul-subway:1002000222"
		);
	});

	test("session logic carries no source names", () => {
		const files = readdirSync(SESSION_DIR).filter(
			(name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
		);
		expect(files.length).toBeGreaterThan(0);
		for (const name of files) {
			const text = readFileSync(join(SESSION_DIR, name), "utf8");
			expect({ match: SOURCE_NAME.exec(text)?.[0] ?? null, name }).toEqual({
				match: null,
				name,
			});
		}
	});
});

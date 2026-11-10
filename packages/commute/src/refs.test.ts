import { describe, expect, test } from "bun:test";
import { lineRef, parseRef, stopRef } from "./refs";

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

	test("rejects unknown source, empty id and missing prefix", () => {
		expect(() => parseRef("tago:GGB1")).toThrow(Error);
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
});

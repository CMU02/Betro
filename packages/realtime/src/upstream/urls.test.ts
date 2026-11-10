import { describe, expect, it } from "bun:test";
import { busPositionUrl, redactKeys, subwayPositionUrl } from "./urls";

describe("urls", () => {
	it("redacts raw and encoded keys", () => {
		const key = "a/b+c=";
		const text = `fail ${busPositionUrl(key, "1")} raw ${key} ${subwayPositionUrl(key, "2호선")}`;
		const out = redactKeys(text, [key, ""]);
		expect(out).not.toContain(key);
		expect(out).not.toContain("a%2Fb%2Bc%3D");
		expect(out).toContain("<key>");
	});
});

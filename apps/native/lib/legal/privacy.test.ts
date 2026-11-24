import { describe, expect, it } from "bun:test";

import { privacyUrl } from "./privacy";

describe("privacyUrl", () => {
	it("끝의 /를 한 번만 둔다", () => {
		expect(privacyUrl("https://api.example.test/")).toBe(
			"https://api.example.test/privacy"
		);
		expect(privacyUrl("https://api.example.test")).toBe(
			"https://api.example.test/privacy"
		);
	});
});

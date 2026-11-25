import { describe, expect, it } from "bun:test";

import { collectLicenses, serializeLicenses } from "../lib/legal/licenses";

describe("collectLicenses", () => {
	const packages: Record<
		string,
		{ license?: string; name: string; version: string }
	> = {
		"a-lib": { license: "MIT", name: "a-lib", version: "1.0.0" },
		"b-lib": { license: "Apache-2.0", name: "b-lib", version: "2.0.0" },
		"c-lib": { name: "c-lib", version: "0.1.0" },
	};
	const read = (name: string) => packages[name] ?? null;

	it("이름순이고 license가 없으면 UNKNOWN이며 workspace 의존성은 없다", () => {
		const result = collectLicenses(
			{
				dependencies: {
					"@Betro/api": "workspace:*",
					"a-lib": "1.0.0",
					"b-lib": "^2.0.0",
					"c-lib": "~0.1.0",
				},
			},
			read
		);
		expect(result).toEqual([
			{ license: "MIT", name: "a-lib", version: "1.0.0" },
			{ license: "Apache-2.0", name: "b-lib", version: "2.0.0" },
			{ license: "UNKNOWN", name: "c-lib", version: "0.1.0" },
		]);
	});

	it("읽지 못한 패키지는 건너뛴다", () => {
		expect(
			collectLicenses({ dependencies: { missing: "1.0.0" } }, read)
		).toEqual([]);
	});
});

describe("serializeLicenses", () => {
	it("Biome JSON 포맷과 같은 2칸 들여쓰기에 끝 줄바꿈으로 쓴다", () => {
		const text = serializeLicenses([
			{ license: "MIT", name: "a-lib", version: "1.0.0" },
		]);
		expect(text).toBe(
			'[\n  {\n    "license": "MIT",\n    "name": "a-lib",\n    "version": "1.0.0"\n  }\n]\n'
		);
	});
});

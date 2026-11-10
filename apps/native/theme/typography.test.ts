import { describe, expect, it } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEXT_STYLES } from "./typography";

describe("TEXT_STYLES", () => {
	it("copies Figma text styles", () => {
		expect(TEXT_STYLES.title1).toEqual({
			fontFamily: "NotoSansKR-Bold",
			fontSize: 24,
			letterSpacing: -0.36,
			lineHeight: 32,
		});
		expect(TEXT_STYLES.micro).toEqual({
			fontFamily: "NotoSansKR-Bold",
			fontSize: 11,
			letterSpacing: 0.11,
			lineHeight: 14,
		});
		expect(TEXT_STYLES.dataXL).toEqual({
			fontFamily: "NotoSansKR-Bold",
			fontSize: 28,
			fontVariant: ["tabular-nums"],
			letterSpacing: -0.56,
			lineHeight: 32,
		});
		expect(TEXT_STYLES.displayL.fontFamily).toBe("NotoSansKR-Black");
	});
});

describe("data variants", () => {
	it("uses Noto Sans KR Bold for XL and L, Medium for M and S", () => {
		expect(TEXT_STYLES.dataXL.fontFamily).toBe("NotoSansKR-Bold");
		expect(TEXT_STYLES.dataL.fontFamily).toBe("NotoSansKR-Bold");
		expect(TEXT_STYLES.dataM.fontFamily).toBe("NotoSansKR-Medium");
		expect(TEXT_STYLES.dataS.fontFamily).toBe("NotoSansKR-Medium");
	});
	it("turns on tabular-nums only for data variants", () => {
		for (const [variant, style] of Object.entries(TEXT_STYLES)) {
			const expected = variant.startsWith("data")
				? ["tabular-nums"]
				: undefined;
			expect(style.fontVariant).toEqual(expected);
		}
	});
});

describe("font subset", () => {
	const chars = readFileSync(
		join(import.meta.dir, "../assets/fonts/subset-chars.txt"),
		"utf8"
	);
	it("covers all KS X 1001 hangul and the symbols the app uses", () => {
		const hangul = [...chars].filter((c) => c >= "가" && c <= "힣");
		expect(hangul.length).toBe(2350);
		for (const c of ["뚝", "섬", "·", "→", "…", "℃"]) {
			expect(chars).toContain(c);
		}
	});
	it("keeps each Noto Sans KR file under 2MB", () => {
		for (const w of ["Regular", "Medium", "Bold", "Black"]) {
			const { size } = statSync(
				join(import.meta.dir, `../assets/fonts/NotoSansKR-${w}.ttf`)
			);
			expect(size).toBeLessThan(2_000_000);
		}
	});
});

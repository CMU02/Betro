/** Figma "Betro App UI" 텍스트 스타일. 자간은 px(크기 × % / 100, 소수 둘째 자리 반올림). */

export type FontFamily =
	| "NotoSansKR-Regular"
	| "NotoSansKR-Medium"
	| "NotoSansKR-Bold"
	| "NotoSansKR-Black";

export type TextVariant =
	| "displayL"
	| "title1"
	| "title2"
	| "title3"
	| "bodyL"
	| "bodyM"
	| "bodyMStrong"
	| "bodyS"
	| "labelM"
	| "labelS"
	| "caption"
	| "micro"
	| "dataXL"
	| "dataL"
	| "dataM"
	| "dataS";

export interface TextStyleSpec {
	fontFamily: FontFamily;
	fontSize: number;
	/** 숫자 자릿수 폭을 고정해 값이 바뀌어도 흔들리지 않게 한다. data* 변형만 쓴다. */
	fontVariant?: "tabular-nums"[];
	letterSpacing: number;
	lineHeight: number;
}

const PERCENT = 100;
const TABULAR_NUMS: "tabular-nums"[] = ["tabular-nums"];

function spec(
	fontFamily: FontFamily,
	fontSize: number,
	lineHeight: number,
	letterSpacingPercent: number,
	tabularNums = false
): TextStyleSpec {
	const letterSpacing =
		Math.round(((fontSize * letterSpacingPercent) / PERCENT) * PERCENT) /
		PERCENT;
	const base = { fontFamily, fontSize, letterSpacing, lineHeight };
	return tabularNums ? { ...base, fontVariant: TABULAR_NUMS } : base;
}

export const TEXT_STYLES: Record<TextVariant, TextStyleSpec> = {
	bodyL: spec("NotoSansKR-Regular", 16, 24, -0.3),
	bodyM: spec("NotoSansKR-Regular", 15, 22, -0.3),
	bodyMStrong: spec("NotoSansKR-Medium", 15, 22, -0.3),
	bodyS: spec("NotoSansKR-Regular", 14, 20, -0.2),
	caption: spec("NotoSansKR-Medium", 12, 16, 0),
	dataL: spec("NotoSansKR-Bold", 18, 24, -1, true),
	dataM: spec("NotoSansKR-Medium", 14, 20, 0, true),
	dataS: spec("NotoSansKR-Medium", 12, 16, 0, true),
	dataXL: spec("NotoSansKR-Bold", 28, 32, -2, true),
	displayL: spec("NotoSansKR-Black", 32, 40, -2),
	labelM: spec("NotoSansKR-Medium", 14, 20, -0.2),
	labelS: spec("NotoSansKR-Medium", 13, 18, -0.2),
	micro: spec("NotoSansKR-Bold", 11, 14, 1),
	title1: spec("NotoSansKR-Bold", 24, 32, -1.5),
	title2: spec("NotoSansKR-Bold", 20, 28, -1),
	title3: spec("NotoSansKR-Bold", 17, 24, -0.5),
};

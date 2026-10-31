const PARENTHESIZED = /[(（][^)）]*[)）]/g;
const WHITESPACE = /\s+/g;
// 가운뎃점(U+00B7), 한글 아래아 점(U+318D), 하이픈, 마이너스(U+2212)를 가운뎃점 하나로 통일한다.
const DOT_OR_DASH = /[·ㆍ\-−]/g;
const STATION_SUFFIX = "역";
/** 이 길이 이상일 때만 끝의 "역"을 뗀다. 두 글자 이하(예: 역곡)는 그대로 둔다. */
const MIN_LENGTH_TO_STRIP_SUFFIX = 3;

/** 출처마다 다른 역명 표기를 비교용 하나의 형태로 맞춘다. */
export function normalizeStationName(name: string): string {
	const normalized = name
		.trim()
		.replace(PARENTHESIZED, "")
		.replace(WHITESPACE, "")
		.replace(DOT_OR_DASH, "·");
	if (
		normalized.length >= MIN_LENGTH_TO_STRIP_SUFFIX &&
		normalized.endsWith(STATION_SUFFIX)
	) {
		return normalized.slice(0, -STATION_SUFFIX.length);
	}
	return normalized;
}

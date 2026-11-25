/**
 * 문자열을 UTF-16 코드 단위 순서로 비교한다. 인자 없는 `sort()`와 같은 순서이고 로캘에 따라 달라지지 않는다.
 * 날짜 폴더 이름·해시처럼 ASCII 값을 늘 같은 순서로 두어야 할 때 쓴다.
 */
export function compareCodeUnits(a: string, b: string): number {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
}

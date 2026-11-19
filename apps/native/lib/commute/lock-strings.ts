import { ko } from "../i18n/messages-ko";

const LOCK_PREFIX = "commute.lock";

function flatten(
	prefix: string,
	node: unknown,
	into: Record<string, string>
): Record<string, string> {
	if (typeof node === "string") {
		into[prefix] = node;
		return into;
	}
	if (node !== null && typeof node === "object") {
		for (const [key, child] of Object.entries(node)) {
			flatten(`${prefix}.${key}`, child, into);
		}
	}
	return into;
}

/**
 * `commute.lock.*` 문구를 점 경로 → 값으로 펼친다. iOS 위젯 확장의 `ko.lproj/Localizable.strings`와
 * 맥의 Swift 대조(`scripts/check-lock-copy-swift.sh`)가 이 값과 같아야 한다.
 */
export function lockStrings(): Record<string, string> {
	return flatten(LOCK_PREFIX, ko.commute.lock, {});
}

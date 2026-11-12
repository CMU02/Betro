const WEAK_PREFIX = "W/";

/**
 * `If-None-Match`가 이 ETag와 맞는가. 쉼표로 나눈 목록, 약한 비교(`W/` 무시), `*`를 받는다.
 * `etag`는 따옴표를 포함한 형태(`"abc"`).
 */
export function ifNoneMatchMatches(
	header: string | undefined,
	etag: string
): boolean {
	if (!header) {
		return false;
	}
	const opaque = etag.startsWith(WEAK_PREFIX)
		? etag.slice(WEAK_PREFIX.length)
		: etag;
	return header.split(",").some((part) => {
		const tag = part.trim();
		if (tag === "*") {
			return true;
		}
		return (
			(tag.startsWith(WEAK_PREFIX) ? tag.slice(WEAK_PREFIX.length) : tag) ===
			opaque
		);
	});
}

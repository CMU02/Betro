/** 개인정보 처리방침 주소. 글은 서버(`GET /privacy`)가 한 곳에서 낸다. 끝의 `/`를 떼고 `/privacy`를 붙인다. */
export function privacyUrl(serverUrl: string): string {
	return `${serverUrl.replace(TRAILING_SLASHES, "")}/privacy`;
}

const TRAILING_SLASHES = /\/+$/;

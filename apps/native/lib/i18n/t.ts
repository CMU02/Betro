import { ko } from "./messages-ko";
import { type MessageKey, type MessageParams, translate } from "./translate";

/** 화면에서 쓰는 번역 함수. MVP의 언어는 한국어 하나다. */
export function t(key: MessageKey, params?: MessageParams): string {
	return translate(ko, key, params);
}

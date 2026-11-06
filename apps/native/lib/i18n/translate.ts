import type { ko } from "./messages-ko";

/** 잎의 문자열 리터럴 타입을 `string`으로 넓힌 같은 모양. 다른 언어 묶음은 이 타입으로 만든다. */
type Widen<T> = T extends string
	? string
	: { readonly [K in keyof T]: Widen<T[K]> };

export type MessageCatalog = Widen<typeof ko>;

/** 묶음의 잎 문자열까지 가는 점 경로. 예: `"tabs.map"`. */
type LeafPaths<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

export type MessageKey = LeafPaths<typeof ko>;

export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

function lookup(catalog: MessageCatalog, key: MessageKey): string {
	let node: unknown = catalog;
	for (const segment of key.split(".")) {
		if (typeof node !== "object" || node === null || !(segment in node)) {
			node = undefined;
			break;
		}
		node = (node as Record<string, unknown>)[segment];
	}
	if (typeof node !== "string") {
		throw new Error(`Unknown message key "${key}"`);
	}
	return node;
}

/**
 * 키의 문구를 찾아 `{이름}` 자리표시자를 채운다.
 * 없는 키나 빠진 값은 빈 문자열이나 `{이름}`을 그리지 않고 오류를 던져 개발 중에 바로 드러나게 한다.
 */
export function translate(
	catalog: MessageCatalog,
	key: MessageKey,
	params?: MessageParams
): string {
	return lookup(catalog, key).replace(PLACEHOLDER, (_match, name: string) => {
		const value = params?.[name];
		if (value === undefined) {
			throw new Error(`Missing message param "${name}" for key "${key}"`);
		}
		return String(value);
	});
}

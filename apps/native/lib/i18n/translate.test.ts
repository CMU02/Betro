import { describe, expect, test } from "bun:test";
import { ko } from "./messages-ko";
import { type MessageKey, translate } from "./translate";

test("returns the Korean message for a key", () => {
	expect(translate(ko, "tabs.map")).toBe("지도");
	expect(translate(ko, "tabs.commute")).toBe("출퇴근");
});

test("fills {param} placeholders", () => {
	expect(translate(ko, "permissions.row.openSettings", { title: "위치" })).toBe(
		"설정 앱에서 위치 권한을 켤 수 있어요"
	);
});

test("accepts number params", () => {
	const catalog = { ...ko, tabs: { ...ko.tabs, map: "{n}분" } };
	expect(translate(catalog, "tabs.map", { n: 3 })).toBe("3분");
});

test("throws when a param is missing", () => {
	expect(() => translate(ko, "permissions.row.openSettings")).toThrow(
		'Missing message param "title" for key "permissions.row.openSettings"'
	);
});

test("throws on an unknown key instead of rendering empty text", () => {
	expect(() => translate(ko, "tabs.nope" as MessageKey)).toThrow(
		'Unknown message key "tabs.nope"'
	);
	expect(() => translate(ko, "tabs" as MessageKey)).toThrow(
		'Unknown message key "tabs"'
	);
});

describe("catalog", () => {
	test("every leaf is a non-empty string", () => {
		const walk = (node: unknown, path: string): void => {
			if (typeof node === "string") {
				expect(node.length, path).toBeGreaterThan(0);
				return;
			}
			for (const [k, v] of Object.entries(node as object)) {
				walk(v, path ? `${path}.${k}` : k);
			}
		};
		walk(ko, "");
	});
});

const _ok: MessageKey = "permissions.row.openSettings";
// @ts-expect-error 잎이 아닌 경로는 키가 아니다
const _notLeaf: MessageKey = "permissions.row";

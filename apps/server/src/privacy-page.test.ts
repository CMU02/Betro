import { describe, expect, test } from "bun:test";

import { renderPrivacyPage } from "./privacy-page";

describe("개인정보 처리방침 페이지", () => {
	test("주소·좌표를 받지 않는다고 쓰고 광고 추적을 하지 않는다고 쓴다", () => {
		const html = renderPrivacyPage({ contact: null, updatedOn: "2026-11-24" });
		expect(html).toContain("주소");
		expect(html).toContain("좌표");
		expect(html).toContain("광고");
		expect(html).toContain("2026-11-24");
		expect(html).not.toContain("<script");
	});

	test("연락처가 없으면 연락처 줄을 뺀다", () => {
		const html = renderPrivacyPage({ contact: null, updatedOn: "2026-11-24" });
		expect(html).not.toContain("문의");
	});

	test("연락처가 있으면 이스케이프해서 넣는다", () => {
		const html = renderPrivacyPage({
			contact: "a@b.test<x>",
			updatedOn: "2026-11-24",
		});
		expect(html).toContain("문의");
		expect(html).toContain("a@b.test&lt;x&gt;");
		expect(html).not.toContain("<x>");
	});

	test("모두 적었다고 단정하지 않고 지도에서 보는 노선·정류장 ID를 밝힌다", () => {
		const html = renderPrivacyPage({ contact: null, updatedOn: "2026-11-24" });
		expect(html).not.toContain("모두 적었어요");
		expect(html).toContain("지도에서 보는 노선");
		expect(html).toContain("즐겨찾기한 정류장");
		expect(html).not.toContain("즐겨찾기와 장소는 기기에만 저장돼요");
	});
});

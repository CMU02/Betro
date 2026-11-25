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
		expect(html).not.toContain("요청해 주세요");
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
		expect(html).toContain("지도와 상세 화면에서 보는 노선");
		expect(html).toContain("즐겨찾기한 정류장");
		expect(html).not.toContain("즐겨찾기와 장소는 기기에만 저장돼요");
	});

	test("보관 기간을 코드의 정리 규칙과 같은 숫자로 밝힌다", () => {
		const html = renderPrivacyPage({ contact: null, updatedOn: "2026-11-25" });
		expect(html).toContain("보관 기간");
		expect(html).toContain("90일");
		expect(html).toContain("1일");
		expect(html).toContain("60일");
		expect(html).toContain("장소를 지울 때까지");
	});

	test("관측 요청 ID는 저장하지 않는다고 단정하지 않고 잠시 보관한다고 쓴다", () => {
		const html = renderPrivacyPage({ contact: null, updatedOn: "2026-11-25" });
		expect(html).not.toContain("저장하지 않아요)");
		expect(html).toContain("잠시 보관");
	});

	test("출퇴근 안내 기록과 설치 ID 삭제 요청 방법을 밝힌다", () => {
		const html = renderPrivacyPage({
			contact: "help@example.test",
			updatedOn: "2026-11-25",
		});
		expect(html).toContain("출퇴근 안내 기록");
		expect(html).toContain("설치 ID");
		expect(html).toContain("help@example.test");
		expect(html).toContain("문의로 요청해 주세요");
	});
});

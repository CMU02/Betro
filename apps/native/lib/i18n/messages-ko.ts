/**
 * 앱의 한국어 사용자 문구. 화면은 문구를 직접 쓰지 않고 `t("키")`로 가져온다.
 *
 * - 키는 `화면.덩어리.역할` 순서로 짓는다. 예: `settings.theme.title`.
 * - 값의 `{이름}`은 `t(key, { 이름: 값 })`으로 채운다.
 * - 문구를 바꿀 때는 Figma 문구 표(`docs/superpowers/plans/2026-11-05-mvp-1-app-foundation.md`의 "문구 변경")를 함께 고친다.
 */
export const ko = {
	permissions: {
		row: {
			openSettings: "설정 앱에서 {title} 권한을 켤 수 있어요",
		},
	},
	tabs: {
		commute: "출퇴근",
		favorites: "즐겨찾기",
		map: "지도",
		settings: "설정",
	},
} as const;

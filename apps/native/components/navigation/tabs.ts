/** 하단 탭 4개. 순서가 곧 화면 순서이고, `name`은 `app/(tabs)/` 안의 라우트 파일 이름이다. */

export type TabName = "index" | "favorites" | "commute" | "settings";

/** Lucide 아이콘 이름. 실제 컴포넌트로 바꾸는 표는 `tab-bar.tsx`에 있다. */
export type TabIconName = "map" | "star" | "route" | "settings";

export interface TabSpec {
	icon: TabIconName;
	label: string;
	name: TabName;
}

export const TABS: readonly TabSpec[] = [
	{ icon: "map", label: "지도", name: "index" },
	{ icon: "star", label: "즐겨찾기", name: "favorites" },
	{ icon: "route", label: "출퇴근", name: "commute" },
	{ icon: "settings", label: "설정", name: "settings" },
] as const;

import type { MessageKey } from "@/lib/i18n/translate";

/** 하단 탭 4개. 순서가 곧 화면 순서이고, `name`은 `app/(tabs)/` 안의 라우트 파일 이름이다. */

export type TabName = "index" | "favorites" | "commute" | "settings";

/** Lucide 아이콘 이름. 실제 컴포넌트로 바꾸는 표는 `tab-bar.tsx`에 있다. */
export type TabIconName = "map" | "star" | "route" | "settings";

export interface TabSpec {
	icon: TabIconName;
	labelKey: MessageKey;
	name: TabName;
}

export const TABS: readonly TabSpec[] = [
	{ icon: "map", labelKey: "tabs.map", name: "index" },
	{ icon: "star", labelKey: "tabs.favorites", name: "favorites" },
	{ icon: "route", labelKey: "tabs.commute", name: "commute" },
	{ icon: "settings", labelKey: "tabs.settings", name: "settings" },
] as const;

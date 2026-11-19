import type { Place } from "../places/places";

/**
 * 잠금화면 카드·다이내믹 아일랜드·Android 알림을 누르면 여는 주소. 출퇴근 탭이 `plan`으로 장소를 찾아
 * 17 출퇴근 안내를 연다. iOS(`CommuteLiveActivity.swift`)와 Android(`CommuteNotifier.kt`)가 같은 모양을 만든다.
 */
export const GUIDE_LINK_PREFIX = "Betro://commute?plan=";

export function guideLink(planId: string): string {
	return `${GUIDE_LINK_PREFIX}${encodeURIComponent(planId)}`;
}

/** 링크의 `plan`에 맞는 장소. 없으면(지운 장소, 표본) null이고 탭에 머문다. */
export function placeIdForPlan(
	places: readonly Place[],
	planId: string | undefined
): string | null {
	if (planId === undefined || planId === "") {
		return null;
	}
	return places.find((place) => place.plan.planId === planId)?.id ?? null;
}

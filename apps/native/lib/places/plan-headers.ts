import type { MessageKey, MessageParams } from "../i18n/translate";
import type { Place, PlaceKind, PlacesState } from "./places";

type Translate = (key: MessageKey, params?: MessageParams) => string;

const HEADER_KEYS = {
	home: "places.header.home",
	other: "places.header.other",
	school: "places.header.school",
	work: "places.header.work",
} as const satisfies Record<PlaceKind, MessageKey>;

const KIND_NAME_KEYS = {
	home: "places.kind.home",
	other: "places.kind.other",
	school: "places.kind.school",
	work: "places.kind.work",
} as const satisfies Record<PlaceKind, MessageKey>;

/** 화면에 보이는 장소 이름. 기타가 아니면 종류 이름이고, 이름 없는 기타 장소는 "가져온 경로"다. */
export function placeNameOf(
	place: Pick<Place, "kind" | "name">,
	t: Translate
): string {
	if (place.kind !== "other") {
		return t(KIND_NAME_KEYS[place.kind]);
	}
	const name = place.name.trim();
	return name === "" ? t("places.importedName") : name;
}

/** 잠금화면과 17 화면의 머리줄. 예: "출근 · 회사까지", "헬스장까지" */
export function headerOf(
	place: Pick<Place, "kind" | "name">,
	t: Translate
): string {
	return t(HEADER_KEYS[place.kind], { name: placeNameOf(place, t) });
}

/** planId → 머리줄 */
export function headersOf(
	places: Place[],
	t: Translate
): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const place of places) {
		headers[place.plan.planId] = headerOf(place, t);
	}
	return headers;
}

/** 기기가 모르는 planId면 null */
export function planHeaderOf(
	planId: string,
	state: PlacesState,
	t: Translate
): string | null {
	const place = state.places.find((entry) => entry.plan.planId === planId);
	return place === undefined ? null : headerOf(place, t);
}

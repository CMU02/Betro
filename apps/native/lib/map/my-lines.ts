import { badgeOf } from "../places/place-card-model";
import type { Place } from "../places/places";
import type { LineBadgeInput } from "../transit/line-badge-model";

export interface MyLine {
	/** 배지 입력. 버스 색과 지역은 장소의 `busMeta`에서 찾는다. */
	badge: LineBadgeInput;
	/** `hiddenMapLines`에 들어가는 노선 참조(구간의 `line`). */
	line: string;
	lineName: string;
	mode: "bus" | "subway";
}

const MODE_ORDER = { bus: 1, subway: 0 } as const;

/**
 * 모든 장소와 모든 경로의 노선을 중복 없이 모은다. 지하철을 먼저 두고, 그 안은 이름순이다.
 * 같은 노선이 여러 번 나오면 먼저 만난 장소의 배지 정보를 쓴다.
 */
export function myLines(places: readonly Place[]): MyLine[] {
	const byLine = new Map<string, MyLine>();
	for (const place of places) {
		for (const route of place.plan.routes) {
			for (const leg of route.legs) {
				if (!byLine.has(leg.line)) {
					byLine.set(leg.line, {
						badge: badgeOf(leg, place.busMeta),
						line: leg.line,
						lineName: leg.lineName,
						mode: leg.mode,
					});
				}
			}
		}
	}
	return [...byLine.values()].sort(
		(a, b) =>
			MODE_ORDER[a.mode] - MODE_ORDER[b.mode] ||
			a.lineName.localeCompare(b.lineName, "ko", { numeric: true })
	);
}

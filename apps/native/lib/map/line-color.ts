import {
	type LineBadgeInput,
	lineBadgeModel,
} from "@/lib/transit/line-badge-model";
import {
	colorToken,
	hexWithAlpha,
	type ThemeMode,
	TRANSIT_COLORS,
} from "@/theme/tokens";

const OPAQUE = 1;

/**
 * 지도 위 노선 선과 차량 마커의 색. 배지와 같은 노선 토큰을 쓰고, 전용 토큰이 없는 노선은 중립 아이콘 색이다.
 * `opacity`가 1보다 작으면 옅은 선(노선 전체)에 쓰는 알파를 붙인다.
 */
export function lineColor(
	input: LineBadgeInput,
	mode: ThemeMode,
	opacity: number = OPAQUE
): string {
	const { colorToken: token } = lineBadgeModel(input);
	const base =
		token === null ? colorToken("icon/secondary", mode) : TRANSIT_COLORS[token];
	return opacity >= OPAQUE ? base : hexWithAlpha(base, opacity);
}

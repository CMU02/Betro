/** Figma `Segmented`의 모양. 설정 화면 테마 선택과 방향 탭이 같은 값을 쓴다. */
export const SEGMENTED_CLASS =
	"h-9 flex-row gap-0.5 rounded-md bg-bg-control p-[3px]";
export const SEGMENT_BASE_CLASS =
	"h-full flex-1 items-center justify-center rounded-sm";
export const SEGMENT_SELECTED_CLASS = "bg-bg-surface-raised";
export const SEGMENT_LABEL_VARIANT = "labelS";
export const SEGMENT_SELECTED_LABEL_CLASS = "text-text-primary";
export const SEGMENT_IDLE_LABEL_CLASS = "text-text-secondary";
/**
 * 고른 칸의 배경. Figma 다크 값은 bg/surface-raised(#1e1f22)가 바탕 bg/control(#27292d)보다 어두워
 * 그림자 없이는 고른 칸이 보이지 않는다. 다크에서는 바탕보다 밝은 border/strong(#393b40)을 쓴다.
 */
export function segmentSelectedClass(isDark: boolean): string {
	return isDark ? "bg-border-strong" : SEGMENT_SELECTED_CLASS;
}

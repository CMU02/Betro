/** Figma "Betro App UI" 토큰(2026-11-10). 이 파일이 원본이고 theme.generated.css는 여기서 만든다. */

export type ThemeMode = "dark" | "light";

export const COLOR_TOKENS = {
	"accent/pressed": { dark: "#a9d916", light: "#a9d916" },
	"accent/primary": { dark: "#c6f432", light: "#c6f432" },
	"accent/soft": { dark: "#26330a", light: "#f0fbc8" },
	"bg/canvas": { dark: "#0e0f10", light: "#f6f6f7" },
	"bg/control": { dark: "#27292d", light: "#eeeef0" },
	"bg/glass": { dark: "#161719db", light: "#ffffffe5" },
	"bg/hover": { dark: "#ffffff14", light: "#0000000f" },
	"bg/inverse": { dark: "#f6f6f7", light: "#0e0f10" },
	"bg/scrim": { dark: "#00000080", light: "#00000080" },
	"bg/surface": { dark: "#161719", light: "#ffffff" },
	"bg/surface-raised": { dark: "#1e1f22", light: "#ffffff" },
	"bg/surface-sunken": { dark: "#070708", light: "#eeeef0" },
	"border/strong": { dark: "#393b40", light: "#bbbdc2" },
	"border/subtle": { dark: "#27292d", light: "#dedfe2" },
	"icon/primary": { dark: "#f6f6f7", light: "#0e0f10" },
	"icon/secondary": { dark: "#90939a", light: "#686b72" },
	"status/delayed": { dark: "#ff6b6b", light: "#d23434" },
	"status/delayed-soft": { dark: "#ff6b6b29", light: "#d234341f" },
	"status/estimated": { dark: "#ffc145", light: "#8f5e00" },
	"status/estimated-soft": { dark: "#ffc14529", light: "#8f5e001f" },
	"status/info": { dark: "#5aa9ff", light: "#1f6fd1" },
	"status/info-soft": { dark: "#5aa9ff29", light: "#1f6fd11f" },
	"status/live": { dark: "#3ddc84", light: "#0b7a3e" },
	"status/live-soft": { dark: "#3ddc8429", light: "#0b7a3e1f" },
	"status/neutral-soft": { dark: "#686b7233", light: "#686b7224" },
	"text/accent": { dark: "#c6f432", light: "#4f6a08" },
	"text/inverse": { dark: "#0e0f10", light: "#ffffff" },
	"text/on-accent": { dark: "#0e0f10", light: "#0e0f10" },
	"text/primary": { dark: "#f6f6f7", light: "#0e0f10" },
	"text/secondary": { dark: "#bbbdc2", light: "#505359" },
	"text/tertiary": { dark: "#90939a", light: "#686b72" },
} as const satisfies Record<string, { dark: string; light: string }>;

export type ColorTokenName = keyof typeof COLOR_TOKENS;

export const TRANSIT_COLORS = {
	"bus/airport": "#00a0e9",
	"bus/branch": "#53b332",
	"bus/circular": "#f2b70a",
	"bus/express": "#e60012",
	"bus/trunk": "#0068b7",
	"bus/village": "#53b332",
	"line/1": "#0052a4",
	"line/2": "#00a84d",
	"line/3": "#ef7c1c",
	"line/4": "#00a5de",
	"line/5": "#996cac",
	"line/6": "#cd7c2f",
	"line/7": "#747f00",
	"line/8": "#e6186c",
	"line/9": "#bdb092",
	"line/airport": "#0090d2",
	"line/gtx-a": "#9a6292",
	"line/gyeongchun": "#178c72",
	"line/gyeongui-jungang": "#77c4a3",
	"line/sinbundang": "#d4003b",
	"line/suin-bundang": "#f5a200",
	"line/ui-sinseol": "#b7c452",
} as const satisfies Record<string, string>;

export type TransitTokenName = keyof typeof TRANSIT_COLORS;

export const RADII = {
	"2xl": 28,
	full: 999,
	lg: 12,
	md: 10,
	sm: 8,
	xl: 16,
	xs: 6,
} as const satisfies Record<string, number>;

/** Figma `Toggle`(4:125)의 손잡이. 두 테마 모두 흰색이다(Android 기본 손잡이는 테마 강조색). */
export const TOGGLE_KNOB_COLOR = "#ffffff";

/**
 * RN `boxShadow` 값. `floating`은 Figma `Elevation/1 Floating` 효과(검정 18%·28% 두 겹)로,
 * 선택된 세그먼트처럼 면 위에 떠 있는 요소에 쓴다.
 */
export const ELEVATION = {
	floating:
		"0px 1px 2px 0px rgba(0, 0, 0, 0.18), 0px 6px 18px 0px rgba(0, 0, 0, 0.28)",
	/** Figma `Toggle` 손잡이 그림자: 검정 25%, 아래로 2, 흐림 4. */
	toggleKnob: "0px 2px 4px 0px rgba(0, 0, 0, 0.25)",
} as const;

export function colorToken(name: ColorTokenName, mode: ThemeMode): string {
	return COLOR_TOKENS[name][mode];
}

const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;
const ALPHA_CHANNEL_MAX = 255;

/**
 * 불투명 토큰에 알파 채널을 붙인 8자리 hex(`#rrggbbaa`). 그림자처럼 Figma 효과가
 * 토큰 색의 일부 불투명도를 쓸 때 쓴다. 이미 알파가 있거나 hex가 아닌 토큰은
 * 조용히 잘못된 색을 만들지 않도록 예외를 던진다.
 */
export function withAlpha(
	name: ColorTokenName,
	mode: ThemeMode,
	opacity: number
): string {
	if (!(opacity >= 0 && opacity <= 1)) {
		throw new Error(
			`withAlpha: opacity must be between 0 and 1, got ${opacity}`
		);
	}
	const color = colorToken(name, mode);
	if (!OPAQUE_HEX.test(color)) {
		throw new Error(
			`withAlpha: token ${name} (${mode}) is ${color}, not a six-digit hex`
		);
	}
	const alpha = Math.round(opacity * ALPHA_CHANNEL_MAX)
		.toString(16)
		.padStart(2, "0");
	return `${color}${alpha}`;
}

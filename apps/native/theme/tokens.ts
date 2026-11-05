/** Figma "Betro App UI" 토큰(2026-11-05). 이 파일이 원본이고 theme.generated.css는 여기서 만든다. */

export type ThemeMode = "dark" | "light";

export const COLOR_TOKENS = {
	"accent/pressed": { dark: "#a9d916", light: "#a9d916" },
	"accent/primary": { dark: "#c6f432", light: "#c6f432" },
	"accent/soft": { dark: "#26330a", light: "#f0fbc8" },
	"bg/canvas": { dark: "#0b0e15", light: "#f5f6f8" },
	"bg/control": { dark: "#232937", light: "#eceef2" },
	"bg/glass": { dark: "#131722c7", light: "#ffffffd6" },
	"bg/hover": { dark: "#ffffff14", light: "#0000000f" },
	"bg/scrim": { dark: "#00000080", light: "#00000080" },
	"bg/surface": { dark: "#131722", light: "#ffffff" },
	"bg/surface-raised": { dark: "#1a1f2b", light: "#ffffff" },
	"bg/surface-sunken": { dark: "#06080c", light: "#eceef2" },
	"border/strong": { dark: "#333a4a", light: "#b6bdca" },
	"border/subtle": { dark: "#232937", light: "#dadee5" },
	"icon/primary": { dark: "#f5f6f8", light: "#0b0e15" },
	"icon/secondary": { dark: "#8a93a4", light: "#687184" },
	"status/delayed": { dark: "#ff6b6b", light: "#d23434" },
	"status/delayed-soft": { dark: "#ff6b6b29", light: "#d234341f" },
	"status/estimated": { dark: "#ffc145", light: "#a86f00" },
	"status/estimated-soft": { dark: "#ffc14529", light: "#a86f001f" },
	"status/info": { dark: "#5aa9ff", light: "#1f6fd1" },
	"status/info-soft": { dark: "#5aa9ff29", light: "#1f6fd11f" },
	"status/live": { dark: "#3ddc84", light: "#0f8a47" },
	"status/live-soft": { dark: "#3ddc8429", light: "#0f8a471f" },
	"status/neutral-soft": { dark: "#68718433", light: "#68718424" },
	"text/accent": { dark: "#c6f432", light: "#4f6a08" },
	"text/inverse": { dark: "#0b0e15", light: "#ffffff" },
	"text/on-accent": { dark: "#0b0e15", light: "#0b0e15" },
	"text/primary": { dark: "#f5f6f8", light: "#0b0e15" },
	"text/secondary": { dark: "#b6bdca", light: "#4b5365" },
	"text/tertiary": { dark: "#687184", light: "#8a93a4" },
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
	lg: 16,
	md: 12,
	sm: 8,
	xl: 20,
	xs: 6,
} as const satisfies Record<string, number>;

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

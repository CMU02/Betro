import {
	COLOR_TOKENS,
	type ColorTokenName,
	colorToken,
	RADII,
	type ThemeMode,
	TRANSIT_COLORS,
} from "./tokens";

const HEROUI_MAP = {
	"--accent": "accent/primary",
	"--accent-foreground": "text/on-accent",
	"--backdrop": "bg/scrim",
	"--background": "bg/canvas",
	"--border": "border/subtle",
	"--danger": "status/delayed",
	"--danger-foreground": "text/on-accent",
	"--default": "bg/control",
	"--default-foreground": "text/primary",
	"--field-background": "bg/control",
	"--field-foreground": "text/primary",
	"--field-placeholder": "text/tertiary",
	"--focus": "accent/primary",
	"--foreground": "text/primary",
	"--link": "text/accent",
	"--muted": "text/tertiary",
	"--overlay": "bg/surface-raised",
	"--overlay-foreground": "text/primary",
	"--segment": "bg/surface-raised",
	"--segment-foreground": "text/primary",
	"--separator": "border/subtle",
	"--success": "status/live",
	"--success-foreground": "text/on-accent",
	"--surface": "bg/surface",
	"--surface-foreground": "text/primary",
	"--surface-secondary": "bg/surface",
	"--surface-secondary-foreground": "text/primary",
	"--surface-tertiary": "bg/surface-raised",
	"--surface-tertiary-foreground": "text/primary",
	"--warning": "status/estimated",
	"--warning-foreground": "text/on-accent",
} as const satisfies Record<string, ColorTokenName>;

/**
 * HeroUI가 `@theme inline static`으로 같은 이름을 정의하는 토큰. 그대로 두면 `bg-accent-soft`가
 * HeroUI의 "accent 15% 혼합색"으로 그려지므로, 테마별 값을 `--betro-*` 변수에 두고
 * `@theme inline`으로 유틸리티가 그 변수를 가리키게 한다.
 */
const HEROUI_INLINE_COLLISIONS = [
	"accent/soft",
] as const satisfies readonly ColorTokenName[];

const cssName = (name: ColorTokenName): string => name.replace("/", "-");

function renderVariant(mode: ThemeMode): string {
	const colors = (Object.keys(COLOR_TOKENS) as ColorTokenName[]).map(
		(name) =>
			`\t\t\t--color-${name.replace("/", "-")}: ${colorToken(name, mode)};`
	);
	const heroui = Object.entries(HEROUI_MAP).map(
		([variable, token]) => `\t\t\t${variable}: ${colorToken(token, mode)};`
	);
	const collisions = HEROUI_INLINE_COLLISIONS.map(
		(name) => `\t\t\t--betro-${cssName(name)}: ${colorToken(name, mode)};`
	);
	return [
		`\t\t@variant ${mode} {`,
		...colors,
		...heroui,
		...collisions,
		"\t\t}",
	].join("\n");
}

export function renderThemeCss(): string {
	const transit = Object.entries(TRANSIT_COLORS).map(
		([name, value]) => `\t--color-transit-${name.replace("/", "-")}: ${value};`
	);
	const radii = Object.entries(RADII).map(
		([name, value]) => `\t--radius-${name}: ${value}px;`
	);
	return [
		"/* 생성 파일, 직접 고치지 말 것. 원본: theme/tokens.ts, 갱신: bun run theme:css */",
		"@layer theme {",
		"\t:root {",
		renderVariant("dark"),
		renderVariant("light"),
		"\t}",
		"}",
		"",
		"@theme {",
		...transit,
		...radii,
		"}",
		"",
		"@theme inline {",
		...HEROUI_INLINE_COLLISIONS.map(
			(name) => `\t--color-${cssName(name)}: var(--betro-${cssName(name)});`
		),
		"}",
		"",
	].join("\n");
}

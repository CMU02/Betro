import { z } from "zod";

export type ThemePreference = "system" | "dark" | "light";

export interface Preferences {
	commuteLiveActivityEnabled: boolean;
	dataSaver: boolean;
	mapQuality: "high3d" | "standard";
	onboardingCompleted: boolean;
	show3dBuildings: boolean;
	smoothVehicleMotion: boolean;
	themeMode: ThemePreference;
	version: 1;
}

export const PREFERENCES_KEY = "betro.preferences";

export const DEFAULT_PREFERENCES: Preferences = {
	commuteLiveActivityEnabled: true,
	dataSaver: false,
	mapQuality: "high3d",
	onboardingCompleted: false,
	show3dBuildings: true,
	smoothVehicleMotion: true,
	themeMode: "system",
	version: 1,
};

const FIELD_SCHEMAS = {
	commuteLiveActivityEnabled: z.boolean(),
	dataSaver: z.boolean(),
	mapQuality: z.enum(["high3d", "standard"]),
	onboardingCompleted: z.boolean(),
	show3dBuildings: z.boolean(),
	smoothVehicleMotion: z.boolean(),
	themeMode: z.enum(["system", "dark", "light"]),
} as const;

type FieldKey = keyof typeof FIELD_SCHEMAS;

const FIELD_KEYS = Object.keys(FIELD_SCHEMAS) as FieldKey[];

function parseJson(raw: string | null): unknown {
	if (raw === null) {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/** 저장된 문자열을 환경설정으로 바꾼다. 깨진 필드만 기본값으로 대체한다. */
export function parsePreferences(raw: string | null): Preferences {
	const data = parseJson(raw);
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return { ...DEFAULT_PREFERENCES };
	}
	const record = data as Record<string, unknown>;
	if (record.version !== 1) {
		return { ...DEFAULT_PREFERENCES };
	}
	const result: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
	for (const key of FIELD_KEYS) {
		const parsed = FIELD_SCHEMAS[key].safeParse(record[key]);
		if (parsed.success) {
			result[key] = parsed.data;
		}
	}
	return result as unknown as Preferences;
}

export function toUniwindTheme(mode: ThemePreference): ThemePreference {
	return mode;
}

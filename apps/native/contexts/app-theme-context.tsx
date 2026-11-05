import type React from "react";
import { createContext, useContext, useEffect, useMemo } from "react";
import { Uniwind, useUniwind } from "uniwind";

import {
	type ThemePreference,
	toUniwindTheme,
} from "@/lib/preferences/preferences";
import { usePreferences } from "@/lib/preferences/use-preferences";

type AppThemeContextType = {
	currentTheme: string;
	isLight: boolean;
	isDark: boolean;
	themeMode: ThemePreference;
	setThemeMode: (mode: ThemePreference) => void;
};

const AppThemeContext = createContext<AppThemeContextType | undefined>(
	undefined
);

export const AppThemeProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const { theme } = useUniwind();
	const [{ themeMode }, update] = usePreferences();

	useEffect(() => {
		Uniwind.setTheme(toUniwindTheme(themeMode));
	}, [themeMode]);

	const value = useMemo(
		() => ({
			currentTheme: theme,
			isDark: theme === "dark",
			isLight: theme === "light",
			setThemeMode: (mode: ThemePreference) => update({ themeMode: mode }),
			themeMode,
		}),
		[theme, themeMode, update]
	);

	return (
		<AppThemeContext.Provider value={value}>
			{children}
		</AppThemeContext.Provider>
	);
};

export function useAppTheme() {
	const context = useContext(AppThemeContext);
	if (!context) {
		throw new Error("useAppTheme must be used within AppThemeProvider");
	}
	return context;
}

import { nativeApplicationVersion } from "expo-application";
import { useRouter } from "expo-router";
import { cn } from "heroui-native";
import {
	BellIcon,
	BoxIcon,
	BugIcon,
	InfoIcon,
	MapIcon,
	MoonIcon,
	RouteIcon,
	ShieldCheckIcon,
	ZapIcon,
} from "lucide-react-native";
import { useCallback } from "react";
import { Alert, Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { ListDivider, ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Section } from "@/components/ui/section";
import { useAppTheme } from "@/contexts/app-theme-context";
import {
	isCrashReportingActive,
	sendTestException,
	triggerNativeCrash,
} from "@/lib/crash/app-crash-reporting";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import type { ThemePreference } from "@/lib/preferences/preferences";
import { usePreferences } from "@/lib/preferences/use-preferences";
import { ELEVATION } from "@/theme/tokens";

const MoonTileIcon = withUniwind(MoonIcon);
const MapTileIcon = withUniwind(MapIcon);
const BoxTileIcon = withUniwind(BoxIcon);
const RouteTileIcon = withUniwind(RouteIcon);
const ZapTileIcon = withUniwind(ZapIcon);
const BellTileIcon = withUniwind(BellIcon);
const ShieldTileIcon = withUniwind(ShieldCheckIcon);
const InfoTileIcon = withUniwind(InfoIcon);
const BugTileIcon = withUniwind(BugIcon);

const THEME_OPTIONS: { labelKey: MessageKey; mode: ThemePreference }[] = [
	{ labelKey: "settings.theme.dark", mode: "dark" },
	{ labelKey: "settings.theme.light", mode: "light" },
	{ labelKey: "settings.theme.system", mode: "system" },
];

/** Figma `Segmented`의 선택된 칸은 `Elevation/1 Floating` 그림자로 떠 있다. */
const SELECTED_SEGMENT_STYLE = { boxShadow: ELEVATION.floating } as const;

const MAP_QUALITY_LABEL_KEY = {
	high3d: "settings.mapQuality.high3d",
	standard: "settings.mapQuality.standard",
} as const satisfies Record<string, MessageKey>;

function ThemeOption({
	label,
	mode,
	onSelect,
	selected,
}: {
	label: string;
	mode: ThemePreference;
	onSelect: (mode: ThemePreference) => void;
	selected: boolean;
}) {
	const handlePress = useCallback(() => onSelect(mode), [mode, onSelect]);
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityState={{ checked: selected }}
			className={cn(
				"h-full flex-1 items-center justify-center rounded-sm",
				selected && "bg-bg-surface-raised"
			)}
			onPress={handlePress}
			style={selected ? SELECTED_SEGMENT_STYLE : undefined}
		>
			<AppText
				className={selected ? "text-text-primary" : "text-text-secondary"}
				variant="labelS"
			>
				{label}
			</AppText>
		</Pressable>
	);
}

function ThemeRow() {
	const { setThemeMode, themeMode } = useAppTheme();
	return (
		<View className="gap-3 px-4 pt-3 pb-4">
			<View className="flex-row items-center gap-3">
				<View className="size-6 items-center justify-center">
					<MoonTileIcon colorClassName="accent-icon-primary" size={20} />
				</View>
				<AppText variant="bodyMStrong">{t("settings.theme.title")}</AppText>
			</View>
			<View
				accessibilityLabel={t("settings.theme.title")}
				accessibilityRole="radiogroup"
				className="h-9 flex-row gap-0.5 rounded-md bg-bg-control p-[3px]"
			>
				{THEME_OPTIONS.map((option) => (
					<ThemeOption
						key={option.mode}
						label={t(option.labelKey)}
						mode={option.mode}
						onSelect={setThemeMode}
						selected={option.mode === themeMode}
					/>
				))}
			</View>
		</View>
	);
}

/** 개발 빌드 전용: Sentry로 테스트 예외를 보내거나 네이티브 크래시를 일으킨다. */
function openCrashTest(): void {
	const message = isCrashReportingActive()
		? t("settings.crashTest.messageActive")
		: t("settings.crashTest.messageInactive");
	Alert.alert(t("settings.crashTest.title"), message, [
		{ style: "cancel", text: t("settings.crashTest.cancel") },
		{ onPress: sendTestException, text: t("settings.crashTest.sendException") },
		{
			onPress: triggerNativeCrash,
			style: "destructive",
			text: t("settings.crashTest.nativeCrash"),
		},
	]);
}

/** 설정 탭(Figma 12). 로그인이 없는 게스트 구성이라 프로필·로그아웃은 없다. */
export default function SettingsTab() {
	const router = useRouter();
	const [preferences, update] = usePreferences();
	const toggleMapQuality = useCallback(() => {
		update({
			mapQuality: preferences.mapQuality === "high3d" ? "standard" : "high3d",
		});
	}, [preferences.mapQuality, update]);
	const toggle3dBuildings = useCallback(
		(value: boolean) => update({ show3dBuildings: value }),
		[update]
	);
	const toggleSmoothMotion = useCallback(
		(value: boolean) => update({ smoothVehicleMotion: value }),
		[update]
	);
	const toggleDataSaver = useCallback(
		(value: boolean) => update({ dataSaver: value }),
		[update]
	);
	const toggleLiveActivity = useCallback(
		(value: boolean) => update({ commuteLiveActivityEnabled: value }),
		[update]
	);
	const openDataSources = useCallback(() => {
		router.push("/settings/data-sources");
	}, [router]);

	return (
		<Screen scroll title={t("tabs.settings")}>
			<View className="gap-5 px-4 pb-6">
				<Section title={t("settings.sections.display")}>
					<ThemeRow />
					<ListDivider />
					<ListRow
						icon={MapTileIcon}
						onPress={toggleMapQuality}
						title={t("settings.mapQuality.title")}
						trailing={{
							chevron: true,
							text: t(MAP_QUALITY_LABEL_KEY[preferences.mapQuality]),
							type: "value",
						}}
					/>
					<ListDivider />
					<ListRow
						icon={BoxTileIcon}
						title={t("settings.buildings3d.title")}
						trailing={{
							onChange: toggle3dBuildings,
							type: "toggle",
							value: preferences.show3dBuildings,
						}}
					/>
					<ListDivider />
					<ListRow
						icon={RouteTileIcon}
						subtitle={t("settings.smoothMotion.subtitle")}
						title={t("settings.smoothMotion.title")}
						trailing={{
							onChange: toggleSmoothMotion,
							type: "toggle",
							value: preferences.smoothVehicleMotion,
						}}
					/>
					<ListDivider />
					<ListRow
						icon={ZapTileIcon}
						title={t("settings.dataSaver.title")}
						trailing={{
							onChange: toggleDataSaver,
							type: "toggle",
							value: preferences.dataSaver,
						}}
					/>
				</Section>
				<Section title={t("settings.sections.notifications")}>
					<ListRow
						icon={BellTileIcon}
						title={t("settings.commuteLockScreen.title")}
						trailing={{
							onChange: toggleLiveActivity,
							type: "toggle",
							value: preferences.commuteLiveActivityEnabled,
						}}
					/>
				</Section>
				<Section title={t("settings.sections.about")}>
					<ListRow
						icon={ShieldTileIcon}
						onPress={openDataSources}
						title={t("settings.dataSources.title")}
						trailing={{ type: "chevron" }}
					/>
					<ListDivider />
					<ListRow
						icon={InfoTileIcon}
						title={t("settings.version.title")}
						trailing={{
							text: nativeApplicationVersion ?? "-",
							type: "value",
						}}
					/>
				</Section>
				{__DEV__ ? (
					<Section title={t("settings.sections.developer")}>
						<ListRow
							icon={BugTileIcon}
							onPress={openCrashTest}
							subtitle={t("settings.crashTest.subtitle")}
							title={t("settings.crashTest.title")}
							trailing={{ type: "none" }}
						/>
					</Section>
				) : null}
			</View>
		</Screen>
	);
}

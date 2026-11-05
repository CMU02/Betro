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
import { type ReactNode, useCallback } from "react";
import { Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { ListDivider, ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { useAppTheme } from "@/contexts/app-theme-context";
import { triggerTestCrash } from "@/lib/crash/app-crash-reporting";
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

const THEME_OPTIONS: { label: string; mode: ThemePreference }[] = [
	{ label: "다크", mode: "dark" },
	{ label: "라이트", mode: "light" },
	{ label: "시스템", mode: "system" },
];

/** Figma `Segmented`의 선택된 칸은 `Elevation/1 Floating` 그림자로 떠 있다. */
const SELECTED_SEGMENT_STYLE = { boxShadow: ELEVATION.floating } as const;

const MAP_QUALITY_LABEL = { high3d: "고화질 3D", standard: "표준" } as const;

function Section({ children, title }: { children: ReactNode; title: string }) {
	return (
		<View className="gap-2">
			<AppText className="text-text-secondary" variant="labelS">
				{title}
			</AppText>
			<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
				{children}
			</View>
		</View>
	);
}

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
			accessibilityState={{ selected }}
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
				<View className="size-10 items-center justify-center rounded-md bg-bg-control">
					<MoonTileIcon colorClassName="accent-icon-primary" size={20} />
				</View>
				<AppText variant="bodyMStrong">테마</AppText>
			</View>
			<View
				accessibilityRole="radiogroup"
				className="h-9 flex-row gap-0.5 rounded-md bg-bg-control p-[3px]"
			>
				{THEME_OPTIONS.map((option) => (
					<ThemeOption
						key={option.mode}
						label={option.label}
						mode={option.mode}
						onSelect={setThemeMode}
						selected={option.mode === themeMode}
					/>
				))}
			</View>
		</View>
	);
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
		<Screen scroll title="설정">
			<View className="gap-5 px-4 pb-6">
				<Section title="화면">
					<ThemeRow />
					<ListDivider />
					<ListRow
						icon={MapTileIcon}
						onPress={toggleMapQuality}
						title="지도 품질"
						trailing={{
							chevron: true,
							text: MAP_QUALITY_LABEL[preferences.mapQuality],
							type: "value",
						}}
					/>
					<ListDivider />
					<ListRow
						icon={BoxTileIcon}
						title="3D 건물"
						trailing={{
							onChange: toggle3dBuildings,
							type: "toggle",
							value: preferences.show3dBuildings,
						}}
					/>
					<ListDivider />
					<ListRow
						icon={RouteTileIcon}
						subtitle="위치를 보간해 자연스럽게 움직여요"
						title="부드러운 차량 이동"
						trailing={{
							onChange: toggleSmoothMotion,
							type: "toggle",
							value: preferences.smoothVehicleMotion,
						}}
					/>
					<ListDivider />
					<ListRow
						icon={ZapTileIcon}
						title="데이터 절약 모드"
						trailing={{
							onChange: toggleDataSaver,
							type: "toggle",
							value: preferences.dataSaver,
						}}
					/>
				</Section>
				<Section title="알림">
					<ListRow
						icon={BellTileIcon}
						title="출퇴근 잠금화면 안내"
						trailing={{
							onChange: toggleLiveActivity,
							type: "toggle",
							value: preferences.commuteLiveActivityEnabled,
						}}
					/>
				</Section>
				<Section title="정보">
					<ListRow
						icon={ShieldTileIcon}
						onPress={openDataSources}
						title="데이터 출처"
						trailing={{ type: "chevron" }}
					/>
					<ListDivider />
					<ListRow
						icon={InfoTileIcon}
						title="버전"
						trailing={{
							text: nativeApplicationVersion ?? "-",
							type: "value",
						}}
					/>
				</Section>
				{__DEV__ ? (
					<Section title="개발">
						<ListRow
							icon={BugTileIcon}
							onPress={triggerTestCrash}
							subtitle="개발 빌드에서만 보여요. 누르면 앱이 바로 종료돼요"
							title="크래시 시험"
							trailing={{ type: "none" }}
						/>
					</Section>
				) : null}
			</View>
		</Screen>
	);
}

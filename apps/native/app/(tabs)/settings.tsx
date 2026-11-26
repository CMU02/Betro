import { nativeApplicationVersion } from "expo-application";
import { useRouter } from "expo-router";
import {
	BellIcon,
	BoxIcon,
	BugIcon,
	FileTextIcon,
	InfoIcon,
	LockIcon,
	LockKeyholeIcon,
	MapIcon,
	MoonIcon,
	RouteIcon,
	ShieldCheckIcon,
	ZapIcon,
} from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Alert, Linking, View } from "react-native";
import { withUniwind } from "uniwind";

import { LineBadge } from "@/components/transit/line-badge";
import { AppText } from "@/components/ui/app-text";
import { ListDivider, ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { useAppTheme } from "@/contexts/app-theme-context";
import { setAppLockScreenGuidance } from "@/lib/commute/app-lock-screen";
import { showLockSamples } from "@/lib/commute/lock-sample-presenter";
import {
	isCrashReportingActive,
	sendTestException,
	triggerNativeCrash,
} from "@/lib/crash/app-crash-reporting";
import { t } from "@/lib/i18n/t";
import type { MessageKey } from "@/lib/i18n/translate";
import { privacyUrl } from "@/lib/legal/privacy";
import { appMotionMetrics } from "@/lib/map/app-motion-metrics";
import { type MyLine, myLines } from "@/lib/map/my-lines";
import { appPlaces } from "@/lib/places/app-places";
import { usePlaces } from "@/lib/places/use-places";
import type { ThemePreference } from "@/lib/preferences/preferences";
import { usePreferences } from "@/lib/preferences/use-preferences";
import { ENV } from "@/src/env";

const MoonTileIcon = withUniwind(MoonIcon);
const MapTileIcon = withUniwind(MapIcon);
const BoxTileIcon = withUniwind(BoxIcon);
const RouteTileIcon = withUniwind(RouteIcon);
const ZapTileIcon = withUniwind(ZapIcon);
const BellTileIcon = withUniwind(BellIcon);
const ShieldTileIcon = withUniwind(ShieldCheckIcon);
const InfoTileIcon = withUniwind(InfoIcon);
const BugTileIcon = withUniwind(BugIcon);
const LockTileIcon = withUniwind(LockIcon);
const PrivacyTileIcon = withUniwind(LockKeyholeIcon);
const LicenseTileIcon = withUniwind(FileTextIcon);

const THEME_OPTIONS: { labelKey: MessageKey; mode: ThemePreference }[] = [
	{ labelKey: "settings.theme.dark", mode: "dark" },
	{ labelKey: "settings.theme.light", mode: "light" },
	{ labelKey: "settings.theme.system", mode: "system" },
];

const MAP_QUALITY_LABEL_KEY = {
	high3d: "settings.mapQuality.high3d",
	standard: "settings.mapQuality.standard",
} as const satisfies Record<string, MessageKey>;

function ThemeRow() {
	const { setThemeMode, themeMode } = useAppTheme();
	const themeSegments = THEME_OPTIONS.map((option) => ({
		key: option.mode,
		label: t(option.labelKey),
	}));
	const handleThemeChange = useCallback(
		(key: string) => setThemeMode(key as ThemePreference),
		[setThemeMode]
	);
	return (
		<View className="gap-3 px-4 pt-3 pb-4">
			<View className="flex-row items-center gap-3">
				<View className="size-6 items-center justify-center">
					<MoonTileIcon colorClassName="accent-icon-primary" size={20} />
				</View>
				<AppText variant="bodyMStrong">{t("settings.theme.title")}</AppText>
			</View>
			<Segmented
				accessibilityLabel={t("settings.theme.title")}
				onChange={handleThemeChange}
				options={themeSegments}
				role="radio"
				value={themeMode}
			/>
		</View>
	);
}

/** 등록한 경로의 노선 하나. 켜면 지도에 차량이 보이고, 끄면 선만 남는다. */
function MapLineRow({
	hidden,
	line,
	onToggle,
}: {
	hidden: boolean;
	line: MyLine;
	onToggle: (line: string, visible: boolean) => void;
}) {
	const handleChange = useCallback(
		(visible: boolean) => onToggle(line.line, visible),
		[line.line, onToggle]
	);
	return (
		<ListRow
			leading={<LineBadge {...line.badge} />}
			title={line.lineName}
			trailing={{ onChange: handleChange, type: "toggle", value: !hidden }}
		/>
	);
}

function MapLinesSection() {
	const { places } = usePlaces(appPlaces);
	const [preferences, update] = usePreferences();
	const lines = useMemo(() => myLines(places), [places]);
	const { hiddenMapLines } = preferences;
	const toggleLine = useCallback(
		(line: string, visible: boolean) => {
			const rest = hiddenMapLines.filter((hidden) => hidden !== line);
			update({ hiddenMapLines: visible ? rest : [...rest, line] });
		},
		[hiddenMapLines, update]
	);
	return (
		<Section title={t("settings.sections.mapLines")}>
			{lines.length === 0 ? (
				<ListRow
					title={t("settings.mapLines.empty")}
					trailing={{ type: "none" }}
				/>
			) : (
				lines.map((line, index) => (
					<View key={line.line}>
						{index > 0 ? <ListDivider inset="edge" /> : null}
						<MapLineRow
							hidden={hiddenMapLines.includes(line.line)}
							line={line}
							onToggle={toggleLine}
						/>
					</View>
				))
			)}
		</Section>
	);
}

const PERCENT = 100;
const PERCENT_DIGITS = 2;

/** 개발 빌드 전용: 오늘의 7.2 지표(뒤로 가거나 순간이동한 위치 갱신 비율). 설정을 열 때의 값이다. */
function motionMetricsSubtitle(): string {
	const { backward, jump, ratio, updates } = appMotionMetrics.summary();
	return t("settings.motionMetrics.subtitle", {
		backward,
		jump,
		percent: (ratio * PERCENT).toFixed(PERCENT_DIGITS),
		updates,
	});
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
	const toggleLiveActivity = useCallback((value: boolean) => {
		setAppLockScreenGuidance(value).catch(() => undefined);
	}, []);
	const openDataSources = useCallback(() => {
		router.push("/settings/data-sources");
	}, [router]);
	const openLicenses = useCallback(() => {
		router.push("/settings/licenses");
	}, [router]);
	const openPrivacy = useCallback(() => {
		// 열 수 있는 브라우저가 없으면 아무 일도 하지 않는다.
		Linking.openURL(privacyUrl(ENV.EXPO_PUBLIC_SERVER_URL)).catch(
			() => undefined
		);
	}, []);
	const openLockSamples = useCallback(() => {
		router.push("/settings/lock-samples");
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
				<MapLinesSection />
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
						accessibilityRole="link"
						icon={PrivacyTileIcon}
						onPress={openPrivacy}
						title={t("settings.privacy.title")}
						trailing={{ type: "chevron" }}
					/>
					<ListDivider />
					<ListRow
						icon={LicenseTileIcon}
						onPress={openLicenses}
						title={t("settings.licenses.title")}
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
				{__DEV__ || showLockSamples ? (
					<Section title={t("settings.sections.developer")}>
						{__DEV__ ? (
							<ListRow
								icon={BugTileIcon}
								onPress={openCrashTest}
								subtitle={t("settings.crashTest.subtitle")}
								title={t("settings.crashTest.title")}
								trailing={{ type: "none" }}
							/>
						) : null}
						{__DEV__ ? (
							<>
								<ListDivider />
								<ListRow
									icon={MapTileIcon}
									subtitle={motionMetricsSubtitle()}
									title={t("settings.motionMetrics.title")}
									trailing={{ type: "none" }}
								/>
							</>
						) : null}
						{__DEV__ && showLockSamples ? <ListDivider /> : null}
						{showLockSamples ? (
							<ListRow
								icon={LockTileIcon}
								onPress={openLockSamples}
								subtitle={t("settings.lockSamples.subtitle")}
								title={t("settings.lockSamples.title")}
								trailing={{ type: "chevron" }}
							/>
						) : null}
					</Section>
				) : null}
			</View>
		</Screen>
	);
}

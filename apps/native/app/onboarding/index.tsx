import { useRouter } from "expo-router";
import { BoxIcon, RouteIcon, ZapIcon } from "lucide-react-native";
import { useCallback } from "react";
import { Image, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { Logo } from "@/components/brand/logo";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";

const ONBOARDING_MAP = require("@/assets/images/onboarding-map.png");

/**
 * Figma 01 온보딩(12:1580)에서 지도가 보이는 영역(393×346).
 * 그 아래는 `Fade/Solid`가 덮으므로 PNG도 여기까지만 잘라 두었다.
 */
const MAP_WIDTH = 393;
const MAP_HEIGHT = 346;
/** Figma `Fade`: y=150부터 16pt 간격으로 불투명도 22% 띠를 12장 겹쳐 아래로 갈수록 캔버스색이 된다. */
const FADE_START = 150;
const FADE_STEP = 16;
const FADE_LAYER_COUNT = 12;
const FADE_LAYER_TOPS = Array.from(
	{ length: FADE_LAYER_COUNT },
	(_, index) =>
		`${((FADE_START + FADE_STEP * index) / MAP_HEIGHT) * 100}%` as const
);
/** iOS(12:1580)는 로고가 지도 위 왼쪽 위에 있고, Android(12:3338)는 제목 바로 위에 있다. */
const IS_ANDROID_LAYOUT = Platform.OS === "android";
/** 상태 표시줄(54pt) 아래 12pt에 로고(iOS). */
const LOGO_GAP_BELOW_STATUS_BAR = 12;
/** 마지막 버튼과 홈 인디케이터 사이 간격. */
const ACTIONS_GAP_ABOVE_HOME_INDICATOR = 8;
const ICON_SIZE = 20;

/**
 * 아이콘은 배경 없는 24pt 상자 안에 20pt로 놓는다. Lucide 아이콘에 `colorClassName`으로
 * 토큰 색을 입힌다. 두 번째 줄은 문구가 바뀌어 Figma의 Bell 대신 Route.
 */
const FEATURES = [
	{
		Icon: withUniwind(ZapIcon),
		labelKey: "onboarding.features.realtime",
	},
	{ Icon: withUniwind(RouteIcon), labelKey: "onboarding.features.lockScreen" },
	{ Icon: withUniwind(BoxIcon), labelKey: "onboarding.features.map3d" },
] as const;

type Feature = (typeof FEATURES)[number];

function FeatureRow({ Icon, labelKey }: Feature) {
	return (
		<View className="flex-row items-center gap-3">
			<View className="size-6 items-center justify-center">
				<Icon colorClassName="accent-text-accent" size={ICON_SIZE} />
			</View>
			<AppText className="flex-1" variant="bodyMStrong">
				{t(labelKey)}
			</AppText>
		</View>
	);
}

function Headline() {
	return (
		<AppText accessibilityRole="header" variant="displayL">
			{`${t("onboarding.headline.lead")}
${t("onboarding.headline.accent")}`}
		</AppText>
	);
}

function MapBackdrop() {
	return (
		<View
			className="absolute inset-x-0 top-0"
			pointerEvents="none"
			style={{ aspectRatio: MAP_WIDTH / MAP_HEIGHT }}
		>
			<Image
				accessibilityIgnoresInvertColors
				resizeMode="cover"
				source={ONBOARDING_MAP}
				style={{ height: "100%", width: "100%" }}
			/>
			{FADE_LAYER_TOPS.map((top) => (
				<View
					className="absolute inset-x-0 bottom-0 bg-bg-canvas opacity-[0.22]"
					key={top}
					style={{ top }}
				/>
			))}
		</View>
	);
}

/** Figma 01 온보딩(12:1580). "이미 계정이 있어요"는 로그인이 MVP에서 빠져 두지 않는다. */
export default function OnboardingScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const goToPermissions = useCallback(() => {
		router.push("/onboarding/permissions");
	}, [router]);

	return (
		<View className="flex-1 bg-bg-canvas">
			<MapBackdrop />
			{IS_ANDROID_LAYOUT ? null : (
				<View
					className="px-4"
					style={{ paddingTop: insets.top + LOGO_GAP_BELOW_STATUS_BAR }}
				>
					<Logo />
				</View>
			)}
			<View
				className="flex-1 justify-end gap-7 px-4"
				style={{
					paddingBottom: insets.bottom + ACTIONS_GAP_ABOVE_HOME_INDICATOR,
				}}
			>
				<View className="gap-4">
					{IS_ANDROID_LAYOUT ? <Logo /> : null}
					<View className="gap-3">
						<Headline />
						<AppText className="text-text-secondary" variant="bodyL">
							{t("onboarding.body")}
						</AppText>
					</View>
				</View>
				<View className="gap-3">
					{FEATURES.map((feature) => (
						<FeatureRow key={feature.labelKey} {...feature} />
					))}
				</View>
				<AppButton label={t("onboarding.start")} onPress={goToPermissions} />
			</View>
		</View>
	);
}

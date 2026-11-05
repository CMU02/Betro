import {
	BottomTabBarHeightCallbackContext,
	type BottomTabBarProps,
} from "expo-router/js-tabs";
import { cn } from "heroui-native";
import {
	MapIcon,
	RouteIcon,
	SettingsIcon,
	StarIcon,
} from "lucide-react-native";
import { useCallback, useContext, useEffect } from "react";
import {
	type LayoutChangeEvent,
	Platform,
	Pressable,
	View,
} from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";

import { TABS, type TabIconName } from "./tabs";

/** Lucide 아이콘에 `colorClassName="accent-…"`로 토큰 색을 입힌다. */
const TAB_ICONS = {
	map: withUniwind(MapIcon),
	route: withUniwind(RouteIcon),
	settings: withUniwind(SettingsIcon),
	star: withUniwind(StarIcon),
} as const satisfies Record<TabIconName, unknown>;

const ICON_SIZE = 24;
/** Figma `TabBar / Platform=iOS` 알약 높이. */
const IOS_BAR_HEIGHT = 64;
/** Figma iOS 화면(393×852)에서 알약 아래 끝이 화면 아래에서 38pt, 홈 인디케이터(34pt) 위 4pt. */
const IOS_BAR_GAP_ABOVE_HOME_INDICATOR = 4;
/** 홈 인디케이터가 없는 기기에서도 화면 끝에 붙지 않게 두는 최소 간격. */
const IOS_BAR_MIN_BOTTOM = 16;
/** Figma `TabBar / Platform=Android`의 아래 여백(pb 16). 제스처 내비게이션 영역은 여기에 더한다. */
const ANDROID_BAR_BOTTOM_PADDING = 16;

interface TabItem {
	icon: TabIconName;
	key: string;
	label: string;
	onLongPress: () => void;
	onPress: () => void;
	selected: boolean;
}

function toTabItems({
	descriptors,
	emitter,
	navigateToTab,
	state,
}: BottomTabBarProps): TabItem[] {
	return state.routes.map((route, index) => {
		const selected = index === state.index;
		const spec = TABS.find((tab) => tab.name === route.name);
		const title = descriptors[route.key]?.options.title;
		return {
			icon: spec?.icon ?? "map",
			key: route.key,
			label: spec?.label ?? title ?? route.name,
			onLongPress: () => {
				emitter.emit({ target: route.key, type: "tabLongPress" });
			},
			onPress: () => {
				const event = emitter.emit({
					canPreventDefault: true,
					target: route.key,
					type: "tabPress",
				});
				if (!(selected || event.defaultPrevented)) {
					navigateToTab(route.key);
				}
			},
			selected,
		};
	});
}

/**
 * Figma는 반투명 `bg-glass` 위에 블러가 깔린 유리 알약이다. 지금은 뒤에 지도가 없어 반투명 배경만 쓰고,
 * 지도 화면을 붙이는 3단계 전에 expo-blur `BlurView`(또는 iOS 26 glass)를 배경으로 깐다.
 */
function IosTabBar(props: BottomTabBarProps) {
	const items = toTabItems(props);
	const reportHeight = useContext(BottomTabBarHeightCallbackContext);
	const bottom = Math.max(
		props.insets.bottom + IOS_BAR_GAP_ABOVE_HOME_INDICATOR,
		IOS_BAR_MIN_BOTTOM
	);

	useEffect(() => {
		reportHeight?.(bottom + IOS_BAR_HEIGHT);
	}, [bottom, reportHeight]);

	return (
		<View
			accessibilityRole="tablist"
			className="absolute right-4 left-4 h-16 flex-row items-center rounded-full border border-border-subtle bg-bg-glass px-1.5"
			style={{ bottom }}
		>
			{items.map((item) => {
				const Icon = TAB_ICONS[item.icon];
				return (
					<Pressable
						accessibilityLabel={item.label}
						accessibilityRole="tab"
						accessibilityState={{ selected: item.selected }}
						className={cn(
							"h-[52px] flex-1 items-center justify-center gap-0.5 rounded-full",
							item.selected && "bg-bg-hover"
						)}
						key={item.key}
						onLongPress={item.onLongPress}
						onPress={item.onPress}
					>
						<Icon
							colorClassName={
								item.selected ? "accent-text-accent" : "accent-text-secondary"
							}
							size={ICON_SIZE}
						/>
						<AppText
							className={
								item.selected ? "text-text-accent" : "text-text-secondary"
							}
							variant="micro"
						>
							{item.label}
						</AppText>
					</Pressable>
				);
			})}
		</View>
	);
}

function AndroidTabBar(props: BottomTabBarProps) {
	const items = toTabItems(props);
	const reportHeight = useContext(BottomTabBarHeightCallbackContext);

	const handleLayout = useCallback(
		(event: LayoutChangeEvent) => {
			reportHeight?.(event.nativeEvent.layout.height);
		},
		[reportHeight]
	);

	return (
		<View
			accessibilityRole="tablist"
			className="flex-row gap-2 bg-bg-surface px-2 pt-3"
			onLayout={handleLayout}
			style={{
				paddingBottom: ANDROID_BAR_BOTTOM_PADDING + props.insets.bottom,
			}}
		>
			{items.map((item) => {
				const Icon = TAB_ICONS[item.icon];
				return (
					<Pressable
						accessibilityLabel={item.label}
						accessibilityRole="tab"
						accessibilityState={{ selected: item.selected }}
						className="flex-1 items-center justify-center gap-1"
						key={item.key}
						onLongPress={item.onLongPress}
						onPress={item.onPress}
					>
						<View
							className={cn(
								"h-8 w-16 items-center justify-center rounded-full",
								item.selected && "bg-accent-soft"
							)}
						>
							<Icon
								colorClassName={
									item.selected ? "accent-text-accent" : "accent-text-secondary"
								}
								size={ICON_SIZE}
							/>
						</View>
						<AppText
							className={
								item.selected ? "text-text-primary" : "text-text-secondary"
							}
							variant="labelS"
						>
							{item.label}
						</AppText>
					</Pressable>
				);
			})}
		</View>
	);
}

/** 하단 탭바. iOS는 Figma 노드 5:39(떠 있는 유리 알약), Android는 5:139(화면 너비 바). */
export function TabBar(props: BottomTabBarProps) {
	if (Platform.OS === "ios") {
		return <IosTabBar {...props} />;
	}
	return <AndroidTabBar {...props} />;
}

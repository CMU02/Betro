import { BottomTabBarHeightContext } from "expo-router/js-tabs";
import { type ReactNode, useContext } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui/app-text";

export interface ScreenProps {
	children?: ReactNode;
	/** true면 본문을 ScrollView로 감싼다. */
	scroll?: boolean;
	/** Figma `LargeTitle`(Title/1, 높이 52, 좌우 16). 없으면 제목 줄을 그리지 않는다. */
	title?: string;
}

/**
 * 탭 안에서 본문 아래에 비워 둘 높이.
 * iOS 탭바는 화면 위에 떠 있으므로 그 높이만큼 비우고, Android 탭바는 화면 아래 공간을 따로 차지하므로 0.
 * 탭 밖(온보딩 등)에서는 홈 인디케이터 영역만 비운다.
 */
function useBottomInset(): number {
	const insets = useSafeAreaInsets();
	const tabBarHeight = useContext(BottomTabBarHeightContext);
	if (tabBarHeight === undefined) {
		return insets.bottom;
	}
	return Platform.OS === "ios" ? tabBarHeight : 0;
}

export function Screen({ children, scroll = false, title }: ScreenProps) {
	const insets = useSafeAreaInsets();
	const bottomInset = useBottomInset();

	const header = title ? (
		<View className="h-[52px] flex-row items-center justify-between px-4">
			<AppText accessibilityRole="header" variant="title1">
				{title}
			</AppText>
		</View>
	) : null;

	if (scroll) {
		return (
			<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
				<ScrollView
					contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomInset }}
					keyboardShouldPersistTaps="handled"
				>
					{header}
					{children}
				</ScrollView>
			</View>
		);
	}

	return (
		<View
			className="flex-1 bg-bg-canvas"
			style={{ paddingBottom: bottomInset, paddingTop: insets.top }}
		>
			{header}
			{children}
		</View>
	);
}

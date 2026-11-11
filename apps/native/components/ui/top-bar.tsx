import { ArrowLeftIcon, ChevronLeftIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";

const BackIcon = withUniwind(ChevronLeftIcon);
const AndroidBackIcon = withUniwind(ArrowLeftIcon);

const BACK_ICON_SIZE = 22;
const ANDROID_BACK_ICON_SIZE = 24;
const IS_ANDROID_LAYOUT = Platform.OS === "android";

export interface TopBarProps {
	onBack?: () => void;
	title: string;
	/** 오른쪽 끝에 놓는 것(예: 저장 버튼). iOS에서 없으면 제목을 가운데에 두려고 빈 칸을 둔다. */
	trailing?: ReactNode;
}

/** iOS `TopBar`: 가운데 제목, 둥근 뒤로 버튼. */
function IosTopBar({ onBack, title, trailing }: TopBarProps) {
	return (
		<View className="h-[52px] flex-row items-center justify-between px-4">
			{onBack ? (
				<Pressable
					accessibilityLabel={t("common.back")}
					accessibilityRole="button"
					className="size-10 items-center justify-center rounded-full bg-bg-control"
					onPress={onBack}
				>
					<BackIcon
						colorClassName="accent-icon-primary"
						size={BACK_ICON_SIZE}
					/>
				</Pressable>
			) : (
				<View className="size-10" />
			)}
			<AppText accessibilityRole="header" variant="title3">
				{title}
			</AppText>
			{trailing ?? <View className="size-10" />}
		</View>
	);
}

/** Android `TopBar`(Figma 17:22159): M3 small top app bar, 왼쪽 화살표와 왼쪽 정렬 제목. */
function AndroidTopBar({ onBack, title, trailing }: TopBarProps) {
	return (
		<View className="h-16 flex-row items-center gap-1 px-1">
			{onBack ? (
				<Pressable
					accessibilityLabel={t("common.back")}
					accessibilityRole="button"
					className="size-12 items-center justify-center rounded-full active:bg-bg-hover"
					onPress={onBack}
				>
					<AndroidBackIcon
						colorClassName="accent-icon-primary"
						size={ANDROID_BACK_ICON_SIZE}
					/>
				</Pressable>
			) : null}
			<AppText accessibilityRole="header" className="flex-1" variant="title2">
				{title}
			</AppText>
			{trailing}
		</View>
	);
}

export function TopBar(props: TopBarProps) {
	return IS_ANDROID_LAYOUT ? (
		<AndroidTopBar {...props} />
	) : (
		<IosTopBar {...props} />
	);
}

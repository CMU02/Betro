import { useRouter } from "expo-router";
import { cn } from "heroui-native";
import {
	ArrowLeftIcon,
	ChevronLeftIcon,
	ShieldCheckIcon,
} from "lucide-react-native";
import { useCallback } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { ListDivider, ListRow } from "@/components/ui/list-row";
import { StatusTag } from "@/components/ui/status-tag";
import {
	DATA_PROVIDERS,
	DATA_SOURCES_FOOTNOTE,
	type DataProvider,
	STATUS_LEGEND,
} from "@/lib/legal/data-sources";

const BackIcon = withUniwind(ChevronLeftIcon);
const AndroidBackIcon = withUniwind(ArrowLeftIcon);
const ProviderIcon = withUniwind(ShieldCheckIcon);

const TAG_SLOT_WIDTH = 92;
const BACK_ICON_SIZE = 22;
const ANDROID_BACK_ICON_SIZE = 24;
const BOTTOM_PADDING = 24;
const INTRO =
	"Betro는 공공 데이터를 받아 차량 위치를 계산해요.\n위치마다 정보의 출처와 정확도를 함께 표시해요.";

function ProviderRow({ provider }: { provider: DataProvider }) {
	const handlePress = useCallback(() => {
		Linking.openURL(provider.url);
	}, [provider.url]);
	return (
		<ListRow
			icon={ProviderIcon}
			onPress={handlePress}
			subtitle={provider.subtitle}
			title={provider.title}
			trailing={{ type: "chevron" }}
		/>
	);
}

/** iOS `TopBar`: 가운데 제목, 둥근 뒤로 버튼. */
function IosTopBar({ onBack }: { onBack: () => void }) {
	return (
		<View className="h-[52px] flex-row items-center justify-between px-4">
			<Pressable
				accessibilityLabel="뒤로"
				accessibilityRole="button"
				className="size-10 items-center justify-center rounded-full bg-bg-control"
				onPress={onBack}
			>
				<BackIcon colorClassName="accent-icon-primary" size={BACK_ICON_SIZE} />
			</Pressable>
			<AppText accessibilityRole="header" variant="title3">
				데이터 출처
			</AppText>
			<View className="size-10" />
		</View>
	);
}

/** Android `TopBar`(Figma 17:22159): M3 small top app bar, 왼쪽 화살표와 왼쪽 정렬 제목. */
function AndroidTopBar({ onBack }: { onBack: () => void }) {
	return (
		<View className="h-16 flex-row items-center gap-1 px-1">
			<Pressable
				accessibilityLabel="뒤로"
				accessibilityRole="button"
				className="size-12 items-center justify-center rounded-full active:bg-bg-hover"
				onPress={onBack}
			>
				<AndroidBackIcon
					colorClassName="accent-icon-primary"
					size={ANDROID_BACK_ICON_SIZE}
				/>
			</Pressable>
			<AppText accessibilityRole="header" className="flex-1" variant="title2">
				데이터 출처
			</AppText>
		</View>
	);
}

const IS_ANDROID_LAYOUT = Platform.OS === "android";

/** 데이터 출처(Figma 13). 위치 표시 방식 범례와 제공 기관 목록. */
export default function DataSourcesScreen() {
	const router = useRouter();
	const goBack = useCallback(() => router.back(), [router]);
	const insets = useSafeAreaInsets();

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			{IS_ANDROID_LAYOUT ? (
				<AndroidTopBar onBack={goBack} />
			) : (
				<IosTopBar onBack={goBack} />
			)}
			<ScrollView
				contentContainerClassName="gap-5 px-4 pt-2"
				contentContainerStyle={{
					paddingBottom: insets.bottom + BOTTOM_PADDING,
				}}
			>
				<AppText className="text-text-secondary">{INTRO}</AppText>
				<View className="gap-3 rounded-lg bg-bg-surface-raised p-4">
					<AppText variant="labelM">위치 표시 방식</AppText>
					{STATUS_LEGEND.map((item) => (
						<View className="flex-row items-center gap-3" key={item.kind}>
							<View style={{ width: TAG_SLOT_WIDTH }}>
								<StatusTag kind={item.kind} label={item.label} />
							</View>
							<AppText className="flex-1 text-text-secondary" variant="bodyS">
								{item.description}
							</AppText>
						</View>
					))}
				</View>
				<View className="gap-2">
					<AppText className="text-text-secondary" variant="labelS">
						제공 기관
					</AppText>
					<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
						{DATA_PROVIDERS.map((provider, index) => (
							<View key={provider.title}>
								{index > 0 ? <ListDivider /> : null}
								<ProviderRow provider={provider} />
							</View>
						))}
					</View>
				</View>
				<AppText
					className={cn(
						"text-text-tertiary",
						IS_ANDROID_LAYOUT ? "text-left" : "text-center"
					)}
					variant="caption"
				>
					{DATA_SOURCES_FOOTNOTE}
				</AppText>
			</ScrollView>
		</View>
	);
}

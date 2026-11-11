import { useRouter } from "expo-router";
import { cn } from "heroui-native";
import { useCallback } from "react";
import { Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui/app-text";
import { ListDivider, ListRow } from "@/components/ui/list-row";
import { StatusTag } from "@/components/ui/status-tag";
import { TopBar } from "@/components/ui/top-bar";
import { t } from "@/lib/i18n/t";
import {
	DATA_PROVIDERS,
	DATA_SOURCES_FOOTNOTE_KEY,
	type DataProvider,
	STATUS_LEGEND,
} from "@/lib/legal/data-sources";

const TAG_SLOT_WIDTH = 92;
const BOTTOM_PADDING = 24;
const IS_ANDROID_LAYOUT = Platform.OS === "android";

function ProviderRow({ provider }: { provider: DataProvider }) {
	const handlePress = useCallback(() => {
		// 열 수 있는 브라우저가 없으면 아무 일도 하지 않는다.
		Linking.openURL(provider.url).catch(() => undefined);
	}, [provider.url]);
	return (
		<ListRow
			accessibilityRole="link"
			onPress={handlePress}
			subtitle={t(provider.subtitleKey)}
			title={t(provider.titleKey)}
			trailing={{ type: "chevron" }}
		/>
	);
}

/** 데이터 출처(Figma 13). 위치 표시 방식 범례와 제공 기관 목록. */
export default function DataSourcesScreen() {
	const router = useRouter();
	const goBack = useCallback(() => router.back(), [router]);
	const insets = useSafeAreaInsets();

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar onBack={goBack} title={t("dataSources.title")} />
			<ScrollView
				contentContainerClassName="gap-5 px-4 pt-2"
				contentContainerStyle={{
					paddingBottom: insets.bottom + BOTTOM_PADDING,
				}}
			>
				<AppText className="text-text-secondary">
					{t("dataSources.intro")}
				</AppText>
				<View className="gap-3 rounded-lg bg-bg-surface-raised p-4">
					<AppText variant="labelM">{t("dataSources.legendTitle")}</AppText>
					{STATUS_LEGEND.map((item) => (
						<View className="flex-row items-center gap-3" key={item.kind}>
							<View style={{ width: TAG_SLOT_WIDTH }}>
								<StatusTag kind={item.kind} label={t(item.labelKey)} />
							</View>
							<AppText className="flex-1 text-text-secondary" variant="bodyS">
								{t(item.descriptionKey)}
							</AppText>
						</View>
					))}
				</View>
				<View className="gap-2">
					<AppText className="text-text-secondary" variant="labelS">
						{t("dataSources.providersTitle")}
					</AppText>
					<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
						{DATA_PROVIDERS.map((provider, index) => (
							<View key={provider.titleKey}>
								{index > 0 ? <ListDivider inset="edge" /> : null}
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
					{t(DATA_SOURCES_FOOTNOTE_KEY)}
				</AppText>
			</ScrollView>
		</View>
	);
}

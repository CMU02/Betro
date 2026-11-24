import { useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import licenses from "@/assets/licenses.json";
import { AppText } from "@/components/ui/app-text";
import { TopBar } from "@/components/ui/top-bar";
import { t } from "@/lib/i18n/t";
import type { LicenseEntry } from "@/lib/legal/licenses";

const BOTTOM_PADDING = 24;
const ENTRIES = licenses as LicenseEntry[];

function keyOf(entry: LicenseEntry): string {
	return entry.name;
}

function LicenseRow({ item }: { item: LicenseEntry }) {
	return (
		<View className="gap-0.5 px-4 py-3">
			<AppText variant="labelM">{item.name}</AppText>
			<AppText className="text-text-secondary" variant="bodyS">
				{`${item.version} · ${item.license}`}
			</AppText>
		</View>
	);
}

/** 오픈소스 라이선스. 의존성 이름·버전·라이선스를 `assets/licenses.json`에서 읽어 보여준다. */
export default function LicensesScreen() {
	const router = useRouter();
	const goBack = useCallback(() => router.back(), [router]);
	const insets = useSafeAreaInsets();
	const renderItem = useCallback(
		({ item }: { item: LicenseEntry }) => <LicenseRow item={item} />,
		[]
	);

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar onBack={goBack} title={t("licenses.title")} />
			<FlatList
				contentContainerStyle={{
					paddingBottom: insets.bottom + BOTTOM_PADDING,
				}}
				data={ENTRIES}
				keyExtractor={keyOf}
				ListHeaderComponent={
					<AppText className="px-4 pt-2 pb-2 text-text-secondary">
						{t("licenses.intro")}
					</AppText>
				}
				renderItem={renderItem}
			/>
		</View>
	);
}

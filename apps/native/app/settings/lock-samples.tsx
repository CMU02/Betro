import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui/app-text";
import { ListDivider, ListRow } from "@/components/ui/list-row";
import { TopBar } from "@/components/ui/top-bar";
import { lockSamplePresenter } from "@/lib/commute/lock-sample-presenter";
import { type LockSample, lockSamples } from "@/lib/commute/lock-samples";
import { t } from "@/lib/i18n/t";

const BOTTOM_PADDING = 24;
const SAMPLES = lockSamples();

function reportFailure(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	Alert.alert(t("settings.lockSamples.failed"), message);
}

function SampleRow({ index, sample }: { index: number; sample: LockSample }) {
	const handlePress = useCallback(() => {
		lockSamplePresenter?.show(sample, index).catch(reportFailure);
	}, [index, sample]);
	return (
		<ListRow
			onPress={handlePress}
			subtitle={sample.status}
			title={sample.name}
			trailing={{ type: "none" }}
		/>
	);
}

/**
 * 개발용 "잠금화면 표본"(`EXPO_PUBLIC_LOCK_SAMPLES=1`). `lock-screen-cases.json`의 사례를 눌러
 * 잠금화면 안내를 띄우고, 화면을 Figma와 기대 문구에 대 본다.
 */
export default function LockSamplesScreen() {
	const router = useRouter();
	const goBack = useCallback(() => router.back(), [router]);
	const insets = useSafeAreaInsets();
	const endAll = useCallback(() => {
		lockSamplePresenter?.endAll().catch(reportFailure);
	}, []);

	return (
		<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
			<TopBar onBack={goBack} title={t("settings.lockSamples.title")} />
			<ScrollView
				contentContainerClassName="gap-5 px-4 pt-2"
				contentContainerStyle={{
					paddingBottom: insets.bottom + BOTTOM_PADDING,
				}}
			>
				<AppText className="text-text-secondary">
					{t("settings.lockSamples.intro")}
				</AppText>
				<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
					<ListRow
						onPress={endAll}
						title={t("settings.lockSamples.endAll")}
						trailing={{ type: "none" }}
					/>
				</View>
				<View className="overflow-hidden rounded-lg bg-bg-surface-raised">
					{SAMPLES.map((sample, index) => (
						<View key={sample.name}>
							{index > 0 ? <ListDivider inset="edge" /> : null}
							<SampleRow index={index} sample={sample} />
						</View>
					))}
				</View>
			</ScrollView>
		</View>
	);
}

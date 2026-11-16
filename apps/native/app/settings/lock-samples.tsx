import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect } from "react";
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

/** `?show=17` 또는 `?show=17,31`의 사례 번호. 범위 밖이거나 숫자가 아니면 뺀다. */
function shownIndexes(show: string | undefined): number[] {
	if (show === undefined) {
		return [];
	}
	return show
		.split(",")
		.map((part) => Number(part))
		.filter(
			(index) => Number.isInteger(index) && index >= 0 && index < SAMPLES.length
		);
}

/**
 * 기기를 손대지 않고 표본을 띄우는 링크(`Betro://settings/lock-samples?show=17`). 여러 번호를 주면
 * 모두 띄운다(iOS 다이내믹 아일랜드 Minimal은 Activity가 둘일 때만 보인다).
 */
function useShowFromLink(): void {
	const { show } = useLocalSearchParams<{ show?: string }>();
	useEffect(() => {
		// 차례대로 띄워야 첫 표본이 앞의 것을 끝내는 규칙과 겹치지 않는다.
		const run = shownIndexes(show).reduce<Promise<void>>(
			(previous, index, order) =>
				previous.then(() => {
					const sample = SAMPLES[index];
					return sample === undefined
						? undefined
						: lockSamplePresenter?.show(sample, index, order > 0);
				}),
			Promise.resolve()
		);
		run.catch(reportFailure);
	}, [show]);
}

/**
 * 개발용 "잠금화면 표본"(`EXPO_PUBLIC_LOCK_SAMPLES=1`). `lock-screen-cases.json`의 사례를 눌러
 * 잠금화면 안내를 띄우고, 화면을 Figma와 기대 문구에 대 본다.
 */
export default function LockSamplesScreen() {
	const router = useRouter();
	const goBack = useCallback(() => router.back(), [router]);
	const insets = useSafeAreaInsets();
	useShowFromLink();
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

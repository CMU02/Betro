import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SetupForm } from "@/components/places/setup-form";
import { EmptyState } from "@/components/ui/empty-state";
import { TopBar } from "@/components/ui/top-bar";
import { t } from "@/lib/i18n/t";
import { appPlaces } from "@/lib/places/app-places";

/**
 * 16 장소 설정(고치기). 연 순간의 장소로 고친다. 이 화면에서 지우거나 저장해 저장소가 바뀌어도
 * 닫힐 때까지 같은 장소를 그린다. 이미 없는 장소면 빈 화면과 뒤로 가기만 보인다.
 */
export default function EditPlaceScreen() {
	const router = useRouter();
	const insets = useSafeAreaInsets();
	const { placeId } = useLocalSearchParams<{ placeId: string }>();
	const [place] = useState(() =>
		appPlaces.get().places.find((entry) => entry.id === placeId)
	);
	const goBack = useCallback(() => router.back(), [router]);

	if (place === undefined) {
		return (
			<View className="flex-1 bg-bg-canvas" style={{ paddingTop: insets.top }}>
				<TopBar onBack={goBack} title={t("placeSetup.title.new")} />
				<EmptyState body={t("places.empty.body")} title={t("notFound.title")} />
			</View>
		);
	}
	return <SetupForm mode="edit" place={place} />;
}

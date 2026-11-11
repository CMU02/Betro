import { useRouter } from "expo-router";
import { BriefcaseIcon } from "lucide-react-native";
import { useCallback } from "react";
import { View } from "react-native";
import { withUniwind } from "uniwind";

import { AddPlaceCard, PlaceCard } from "@/components/places/place-card";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { t } from "@/lib/i18n/t";
import { appPlaces } from "@/lib/places/app-places";
import type { Place } from "@/lib/places/places";
import { usePlaces } from "@/lib/places/use-places";

const EMPTY_ICON_SIZE = 40;

const EmptyBriefcase = withUniwind(BriefcaseIcon);

/** 16, 17 화면은 Task 8, 9에서 만든다. 그 전에는 타입 검사가 경로를 모르므로 `never`로 넘긴다. */
const NEW_PLACE_HREF = "/places/new" as never;

/** 15 내 장소. 장소가 없으면 빈 상태, 있으면 카드 목록과 "장소 추가". */
export default function CommuteTab() {
	const router = useRouter();
	const { places } = usePlaces(appPlaces);

	const addPlace = useCallback(() => router.push(NEW_PLACE_HREF), [router]);
	const openGuide = useCallback(
		(place: Place) => router.push(`/commute/${place.id}` as never),
		[router]
	);
	const editPlace = useCallback(
		(place: Place) => router.push(`/places/${place.id}` as never),
		[router]
	);

	if (places.length === 0) {
		return (
			<Screen scroll title={t("tabs.commute")}>
				<View className="flex-1 justify-center px-4 pb-12">
					<EmptyState
						action={
							<AppButton
								className="w-[200px]"
								label={t("places.add")}
								onPress={addPlace}
							/>
						}
						body={t("places.empty.body")}
						icon={
							<EmptyBriefcase
								colorClassName="accent-icon-secondary"
								size={EMPTY_ICON_SIZE}
							/>
						}
						title={t("places.empty.title")}
					/>
				</View>
			</Screen>
		);
	}

	return (
		<Screen scroll title={t("tabs.commute")}>
			<View className="gap-3 px-4 pt-2 pb-4">
				<AppText className="text-text-secondary" variant="bodyS">
					{t("places.intro")}
				</AppText>
				{places.map((place) => (
					<PlaceCard
						key={place.id}
						onEdit={editPlace}
						onOpen={openGuide}
						place={place}
					/>
				))}
				<AddPlaceCard onPress={addPlace} />
			</View>
		</Screen>
	);
}

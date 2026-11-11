import { DEFAULT_TIMEZONE } from "@Betro/commute/config";
import { useRouter } from "expo-router";
import { BriefcaseIcon } from "lucide-react-native";
import { useCallback } from "react";
import { View } from "react-native";
import { withUniwind } from "uniwind";

import { SessionStrip } from "@/components/commute/session-strip";
import { AddPlaceCard, PlaceCard } from "@/components/places/place-card";
import { AppButton } from "@/components/ui/app-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { sessionStripModel } from "@/lib/commute/guide-model";
import {
	useActiveSession,
	useEpochSeconds,
} from "@/lib/commute/use-active-session";
import { t } from "@/lib/i18n/t";
import { appPlaces } from "@/lib/places/app-places";
import type { Place } from "@/lib/places/places";
import { usePlaces } from "@/lib/places/use-places";

const EMPTY_ICON_SIZE = 40;

const EmptyBriefcase = withUniwind(BriefcaseIcon);

const NEW_PLACE_HREF = "/places/new";

/** 15 내 장소. 장소가 없으면 빈 상태, 있으면 카드 목록과 "장소 추가". */
export default function CommuteTab() {
	const router = useRouter();
	const { places } = usePlaces(appPlaces);
	const { state } = useActiveSession({ enabled: places.length > 0 });
	const now = useEpochSeconds();
	const strip = sessionStripModel({
		now,
		places,
		session: state?.session ?? null,
		t,
		timezone: DEFAULT_TIMEZONE,
	});

	const addPlace = useCallback(() => router.push(NEW_PLACE_HREF), [router]);
	const openGuideById = useCallback(
		(placeId: string) =>
			router.push({ params: { placeId }, pathname: "/commute/[placeId]" }),
		[router]
	);
	const openGuide = useCallback(
		(place: Place) => openGuideById(place.id),
		[openGuideById]
	);
	const editPlace = useCallback(
		(place: Place) =>
			router.push({
				params: { placeId: place.id },
				pathname: "/places/[placeId]",
			}),
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
				{strip === null ? null : (
					<SessionStrip model={strip} onOpen={openGuideById} />
				)}
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

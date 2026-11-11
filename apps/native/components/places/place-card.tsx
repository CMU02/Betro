import {
	BriefcaseIcon,
	GraduationCapIcon,
	HouseIcon,
	MapPinIcon,
	PencilIcon,
	PlusIcon,
} from "lucide-react-native";
import { memo, useCallback } from "react";
import { Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { LineBadge } from "@/components/transit/line-badge";
import { AppText } from "@/components/ui/app-text";
import { t } from "@/lib/i18n/t";
import { placeCardModel } from "@/lib/places/place-card-model";
import type { Place, PlaceKind } from "@/lib/places/places";

const KIND_ICON_SIZE = 24;
const EDIT_ICON_SIZE = 20;

const KindBriefcase = withUniwind(BriefcaseIcon);
const KindSchool = withUniwind(GraduationCapIcon);
const KindHouse = withUniwind(HouseIcon);
const KindPin = withUniwind(MapPinIcon);
const EditPencil = withUniwind(PencilIcon);
const AddPlus = withUniwind(PlusIcon);

function KindIcon({ kind }: { kind: PlaceKind }) {
	const props = { colorClassName: "accent-icon-primary", size: KIND_ICON_SIZE };
	switch (kind) {
		case "work":
			return <KindBriefcase {...props} />;
		case "school":
			return <KindSchool {...props} />;
		case "home":
			return <KindHouse {...props} />;
		default:
			return <KindPin {...props} />;
	}
}

export interface PlaceCardProps {
	onEdit: (place: Place) => void;
	onOpen: (place: Place) => void;
	place: Place;
}

/** Figma `PlaceCard`(91:2391). 아이콘 + 이름 + 연필, 기본 경로의 구간, 일정, 서버에 올라가지 않았다는 표시. */
export const PlaceCard = memo(function PlaceCardView({
	onEdit,
	onOpen,
	place,
}: PlaceCardProps) {
	const model = placeCardModel(place, t);
	const handleOpen = useCallback(() => onOpen(place), [onOpen, place]);
	const handleEdit = useCallback(() => onEdit(place), [onEdit, place]);
	const summary = [model.schedule, model.alternatives]
		.filter((part) => part !== null)
		.join(" · ");
	return (
		<View className="gap-3 rounded-lg bg-bg-surface-raised p-4">
			<View className="flex-row items-center gap-3">
				<Pressable
					accessibilityLabel={t("places.openGuide", { name: model.title })}
					accessibilityRole="button"
					className="flex-1 flex-row items-center gap-3"
					onPress={handleOpen}
				>
					<KindIcon kind={place.kind} />
					<AppText className="flex-1" numberOfLines={1} variant="title3">
						{model.title}
					</AppText>
				</Pressable>
				<Pressable
					accessibilityLabel={t("places.edit", { name: model.title })}
					accessibilityRole="button"
					className="size-8 items-center justify-center"
					hitSlop={8}
					onPress={handleEdit}
				>
					<EditPencil
						colorClassName="accent-icon-secondary"
						size={EDIT_ICON_SIZE}
					/>
				</Pressable>
			</View>
			<Pressable
				accessibilityRole="button"
				className="gap-3"
				onPress={handleOpen}
			>
				<View className="gap-1.5">
					{model.legs.map((leg) => (
						<View
							className="flex-row items-center gap-2"
							key={`${leg.badge.name}-${leg.from}-${leg.to}`}
						>
							<LineBadge {...leg.badge} />
							<AppText className="flex-1" variant="bodyM">
								{t("places.legArrow", { from: leg.from, to: leg.to })}
							</AppText>
						</View>
					))}
				</View>
				<AppText className="text-text-secondary" variant="bodyS">
					{summary}
				</AppText>
			</Pressable>
			{model.notSynced ? (
				<View className="flex-row items-center gap-1.5">
					<View className="size-1.5 rounded-full bg-status-warning" />
					<AppText className="text-text-secondary" variant="caption">
						{t("places.notSynced")}
					</AppText>
				</View>
			) : null}
		</View>
	);
});

/** Figma `PlaceCard/추가`. 점선 테두리 카드. */
export function AddPlaceCard({ onPress }: { onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			className="flex-row items-center gap-3 rounded-lg border border-border-strong border-dashed p-4 active:bg-bg-hover"
			onPress={onPress}
		>
			<AddPlus colorClassName="accent-icon-primary" size={KIND_ICON_SIZE} />
			<View className="flex-1 gap-0.5">
				<AppText variant="bodyMStrong">{t("places.add")}</AppText>
				<AppText className="text-text-secondary" variant="caption">
					{t("places.addHint")}
				</AppText>
			</View>
		</Pressable>
	);
}

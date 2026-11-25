import { memo, useCallback } from "react";
import { ScrollView } from "react-native";

import { Chip } from "@/components/ui/chip";
import { t } from "@/lib/i18n/t";
import { type ChipState, chipLabel } from "@/lib/map/map-labels";
import type { PlaceChip } from "@/lib/map/selection";

const CHIPS_CONTENT_CLASS = "gap-2 px-4";

const PlaceChipItem = memo(function PlaceChipItemView({
	chip,
	onPress,
	state,
}: {
	chip: PlaceChip;
	onPress: (placeId: string) => void;
	state: ChipState;
}) {
	const handlePress = useCallback(() => onPress(chip.id), [onPress, chip.id]);
	return (
		<Chip
			label={chipLabel(chip.label, state)}
			onPress={handlePress}
			selected={chip.selected}
		/>
	);
});

function stateOf(chip: PlaceChip, menuOpen: boolean): ChipState {
	if (!chip.selected) {
		return "idle";
	}
	return menuOpen ? "open" : "selected";
}

/**
 * 지도 위쪽 장소 칩(지도 설계 2.2). 고른 칩에만 ▾가 붙고, 그 칩을 다시 누르면 경로 목록이 펼쳐지며 ▴가 된다.
 * 칩을 누르는 동작은 화면이 정한다.
 */
export function PlaceChips({
	chips,
	menuOpen,
	onPress,
}: {
	chips: readonly PlaceChip[];
	menuOpen: boolean;
	onPress: (placeId: string) => void;
}) {
	return (
		<ScrollView
			accessibilityLabel={t("map.chips.label")}
			contentContainerClassName={CHIPS_CONTENT_CLASS}
			horizontal
			keyboardShouldPersistTaps="handled"
			showsHorizontalScrollIndicator={false}
		>
			{chips.map((chip) => (
				<PlaceChipItem
					chip={chip}
					key={chip.id}
					onPress={onPress}
					state={stateOf(chip, menuOpen)}
				/>
			))}
		</ScrollView>
	);
}

import { CheckIcon } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { routeOptionLabel } from "@/lib/map/map-labels";
import type { RouteOption } from "@/lib/map/selection";

const Check = withUniwind(CheckIcon);

const CHECK_ICON_SIZE = 18;

const RouteMenuRow = memo(function RouteMenuRowView({
	onSelect,
	option,
}: {
	onSelect: (rank: number) => void;
	option: RouteOption;
}) {
	const handlePress = useCallback(
		() => onSelect(option.rank),
		[onSelect, option.rank]
	);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected: option.selected }}
			className="h-12 flex-row items-center gap-2 px-4 active:bg-bg-hover"
			onPress={handlePress}
		>
			<View className="w-[18px]">
				{option.selected ? (
					<Check colorClassName="accent-text-accent" size={CHECK_ICON_SIZE} />
				) : null}
			</View>
			<AppText
				className="flex-1"
				numberOfLines={1}
				variant={option.selected ? "bodyMStrong" : "bodyM"}
			>
				{routeOptionLabel(option)}
			</AppText>
		</Pressable>
	);
});

/**
 * 칩을 다시 눌렀을 때 칩 아래에 펼쳐지는 경로 목록(지도 설계 2.2). "✓ 기본 · 470 → 2호선"처럼
 * 고른 경로에만 체크가 붙는다. 하나를 고르면 지도의 차량이 그 경로로 바뀐다.
 */
export function RouteMenu({
	onSelect,
	options,
}: {
	onSelect: (rank: number) => void;
	options: readonly RouteOption[];
}) {
	return (
		<View className="mx-4 overflow-hidden rounded-xl bg-bg-surface py-1">
			{options.map((option) => (
				<RouteMenuRow key={option.rank} onSelect={onSelect} option={option} />
			))}
		</View>
	);
}

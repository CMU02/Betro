import { ChevronRightIcon } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { LineBadge } from "@/components/transit/line-badge";
import { AppText } from "@/components/ui/app-text";
import { StatusTag } from "@/components/ui/status-tag";
import type { SessionStripModel } from "@/lib/commute/guide-model";

const Chevron = withUniwind(ChevronRightIcon);

const CHEVRON_SIZE = 20;

/** Figma `SessionStrip`(93:2382). 15 맨 위의 진행 중 세션 띠. 누르면 그 장소의 17로 간다. */
export function SessionStrip({
	model,
	onOpen,
}: {
	model: SessionStripModel;
	onOpen: (placeId: string) => void;
}) {
	const handlePress = useCallback(
		() => onOpen(model.placeId),
		[model.placeId, onOpen]
	);
	return (
		<Pressable
			accessibilityRole="button"
			className="flex-row items-center gap-3 rounded-lg border border-border-strong bg-bg-surface-raised px-4 py-3 active:bg-bg-hover"
			onPress={handlePress}
		>
			<LineBadge {...model.badge} />
			<View className="flex-1 gap-0.5">
				<View className="flex-row items-center gap-2">
					<AppText
						className="shrink text-text-secondary"
						numberOfLines={1}
						variant="caption"
					>
						{model.header}
					</AppText>
					<StatusTag kind={model.tag} label={model.tagLabel} />
				</View>
				<AppText numberOfLines={1} variant="bodyMStrong">
					{model.status}
				</AppText>
			</View>
			<Chevron colorClassName="accent-icon-secondary" size={CHEVRON_SIZE} />
		</Pressable>
	);
}

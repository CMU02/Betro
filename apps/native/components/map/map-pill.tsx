import { cn } from "heroui-native";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";

export type MapPillTone = "plain" | "live" | "estimated";

const DOT_BY_TONE: Record<MapPillTone, string | null> = {
	estimated: "bg-status-estimated",
	live: "bg-status-live",
	plain: null,
};

/** 지도 위 작은 알약. 칩 아래의 지금 경로, 근처 지하철, 안내 한 줄에 쓴다(Figma 04 지도 홈 MVP4 변형). */
export function MapPill({
	label,
	tone = "plain",
}: {
	label: string;
	tone?: MapPillTone;
}) {
	const dot = DOT_BY_TONE[tone];
	return (
		<View className="h-7 flex-row items-center gap-1.5 self-start rounded-full bg-bg-glass px-3">
			{dot === null ? null : (
				<View className={cn("size-1.5 rounded-full", dot)} />
			)}
			<AppText
				className="text-text-primary"
				numberOfLines={1}
				variant="caption"
			>
				{label}
			</AppText>
		</View>
	);
}

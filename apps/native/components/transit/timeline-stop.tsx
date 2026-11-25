import { cn } from "heroui-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";

export type TimelineStopState = "current" | "passed" | "upcoming";

export interface TimelineStopProps {
	/** 레일 끝 처리. 첫 정류장은 위 선을, 마지막은 아래 선을 그리지 않는다. */
	first?: boolean;
	last?: boolean;
	name: string;
	state: TimelineStopState;
	/** 이름 아래 작은 글자(정차 시각, ars 번호 등). */
	subtitle?: string;
	/** 오른쪽 끝(도착 시각 등). */
	trailing?: ReactNode;
}

const DOT_BY_STATE: Record<TimelineStopState, string> = {
	current: "size-4 bg-accent-primary",
	passed: "size-2.5 bg-border-strong",
	upcoming: "size-2.5 border-2 border-border-strong bg-bg-canvas",
};

const NAME_BY_STATE: Record<TimelineStopState, string> = {
	current: "text-text-primary",
	passed: "text-text-tertiary",
	upcoming: "text-text-primary",
};

/** Figma `TimelineStop`(Passed/Current/Upcoming). 왼쪽 레일 점과 선, 오른쪽에 이름. */
export function TimelineStop({
	first = false,
	last = false,
	name,
	state,
	subtitle,
	trailing,
}: TimelineStopProps) {
	return (
		<View className="min-h-12 flex-row items-stretch gap-3 px-4">
			<View className="w-4 items-center">
				<View
					className={cn(
						"w-0.5 flex-1",
						first ? "bg-transparent" : "bg-border-strong"
					)}
				/>
				<View className={cn("rounded-full", DOT_BY_STATE[state])} />
				<View
					className={cn(
						"w-0.5 flex-1",
						last ? "bg-transparent" : "bg-border-strong"
					)}
				/>
			</View>
			<View className="flex-1 justify-center py-2">
				<AppText
					className={NAME_BY_STATE[state]}
					numberOfLines={1}
					variant={state === "current" ? "bodyMStrong" : "bodyM"}
				>
					{name}
				</AppText>
				{subtitle ? (
					<AppText
						className="text-text-secondary"
						numberOfLines={1}
						variant="caption"
					>
						{subtitle}
					</AppText>
				) : null}
			</View>
			{trailing ? <View className="justify-center">{trailing}</View> : null}
		</View>
	);
}

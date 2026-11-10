import { cn } from "heroui-native";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import type { StatusKind } from "@/lib/legal/data-sources";

export interface StatusTagProps {
	kind: StatusKind;
	label: string;
}

const DOT_BY_KIND: Record<StatusKind, string> = {
	delayed: "bg-status-delayed",
	ended: "bg-text-tertiary",
	estimated: "bg-status-estimated",
	live: "bg-status-live",
};

const TEXT_BY_KIND: Record<StatusKind, string> = {
	delayed: "text-status-delayed",
	ended: "text-text-tertiary",
	estimated: "text-status-estimated",
	live: "text-status-live",
};

/** Figma `StatusTag`(4:60). 점과 라벨로 위치 정보의 신선도를 보여준다. */
export function StatusTag({ kind, label }: StatusTagProps) {
	return (
		<View className="flex-row items-center gap-[5px] self-start">
			<View className={cn("size-1.5 rounded-full", DOT_BY_KIND[kind])} />
			<AppText className={TEXT_BY_KIND[kind]} variant="caption">
				{label}
			</AppText>
		</View>
	);
}

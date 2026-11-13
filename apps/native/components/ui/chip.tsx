import { cn } from "heroui-native";
import { Pressable } from "react-native";

import { AppText } from "@/components/ui/app-text";

export interface ChipProps {
	label: string;
	onPress: () => void;
	selected: boolean;
}

/** 선택된 칩은 `bg/inverse` + `text/inverse`다(라임은 쓰지 않는다). */
export function Chip({ label, onPress, selected }: ChipProps) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected }}
			className={cn(
				"h-9 items-center justify-center rounded-full px-4",
				selected ? "bg-bg-inverse" : "bg-bg-control active:bg-bg-hover"
			)}
			onPress={onPress}
		>
			<AppText
				className={selected ? "text-text-inverse" : "text-text-primary"}
				variant="labelM"
			>
				{label}
			</AppText>
		</Pressable>
	);
}

import { cn } from "heroui-native";
import type { ReactNode } from "react";
import { Pressable } from "react-native";

export interface IconButtonProps {
	accessibilityLabel: string;
	/** 아이콘. 색은 호출하는 쪽이 `accent-icon-primary`로 칠한다. */
	children: ReactNode;
	onPress: () => void;
	/** glass는 지도 위에 얹는 반투명, solid는 화면 배경 위의 `bg/control`. */
	variant?: "glass" | "solid";
}

const BACKGROUND_BY_VARIANT = {
	glass: "bg-bg-glass",
	solid: "bg-bg-control active:bg-bg-hover",
} as const;

/** Figma `IconButton`(Glass/Solid). 40pt 원. */
export function IconButton({
	accessibilityLabel,
	children,
	onPress,
	variant = "solid",
}: IconButtonProps) {
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel}
			accessibilityRole="button"
			className={cn(
				"size-10 items-center justify-center rounded-full",
				BACKGROUND_BY_VARIANT[variant]
			)}
			onPress={onPress}
		>
			{children}
		</Pressable>
	);
}

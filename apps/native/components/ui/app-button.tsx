import { cn } from "heroui-native";
import { Pressable, type PressableProps } from "react-native";

import { AppText } from "@/components/ui/app-text";

export type AppButtonVariant = "primary" | "secondary" | "ghost";
/** Figma `Button`: Large는 52pt 전체 너비 CTA, Medium은 40pt 인라인 버튼. */
export type AppButtonSize = "large" | "medium";

export interface AppButtonProps extends Omit<PressableProps, "children"> {
	className?: string;
	label: string;
	size?: AppButtonSize;
	variant?: AppButtonVariant;
}

const CONTAINER_BY_SIZE: Record<AppButtonSize, string> = {
	large: "h-[52px] w-full rounded-lg px-5",
	medium: "h-10 rounded-md px-4",
};

const CONTAINER_BY_VARIANT: Record<AppButtonVariant, string> = {
	ghost: "active:bg-bg-hover",
	primary: "bg-accent-primary active:bg-accent-pressed",
	secondary: "bg-bg-control active:bg-bg-hover",
};

const LABEL_BY_VARIANT: Record<AppButtonVariant, string> = {
	ghost: "text-text-primary",
	primary: "text-text-on-accent",
	secondary: "text-text-primary",
};

/** Figma `Button`(4:109). 비활성일 때는 글자를 흐리게 하고 누를 수 없다. */
export function AppButton({
	className,
	disabled,
	label,
	size = "large",
	variant = "primary",
	...props
}: AppButtonProps) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled: Boolean(disabled) }}
			className={cn(
				"flex-row items-center justify-center",
				CONTAINER_BY_SIZE[size],
				CONTAINER_BY_VARIANT[variant],
				className
			)}
			disabled={disabled}
			{...props}
		>
			<AppText
				className={cn(
					LABEL_BY_VARIANT[variant],
					disabled && "text-text-tertiary"
				)}
				variant={size === "large" ? "bodyMStrong" : "labelM"}
			>
				{label}
			</AppText>
		</Pressable>
	);
}

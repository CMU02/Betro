import { cn } from "heroui-native";
import { Text, type TextProps } from "react-native";
import { TEXT_STYLES, type TextVariant } from "@/theme/typography";

const MAX_FONT_SIZE_MULTIPLIER = 1.3;

export interface AppTextProps extends TextProps {
	className?: string;
	variant?: TextVariant;
}

export function AppText({
	variant = "bodyM",
	className,
	style,
	...props
}: AppTextProps) {
	return (
		<Text
			className={cn("text-text-primary", className)}
			// 한글을 글자 단위가 아니라 어절 단위로 줄바꿈한다("정 / 보"처럼 끊기지 않게).
			lineBreakStrategyIOS="hangul-word"
			maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
			style={[TEXT_STYLES[variant], style]}
			{...props}
		/>
	);
}

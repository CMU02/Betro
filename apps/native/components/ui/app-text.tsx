import { cn } from "heroui-native";
import { Text, type TextProps } from "react-native";
import { TEXT_STYLES, type TextVariant } from "@/theme/typography";

export const MAX_FONT_SIZE_MULTIPLIER = 1.3;

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
			// Android에는 어절 단위 줄바꿈 속성이 없다(RN 0.88은 LineBreakConfig 단어 스타일을 넘기지 않는다).
			// 줄 길이를 고르게 나눠 마지막 줄에 한두 글자("워요")만 남는 경우를 줄인다. 어절 중간 줄바꿈은 남는다.
			textBreakStrategy="balanced"
			{...props}
		/>
	);
}

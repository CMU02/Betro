import { TextInput, type TextInputProps } from "react-native";

import { MAX_FONT_SIZE_MULTIPLIER } from "@/components/ui/app-text";
import { TEXT_STYLES } from "@/theme/typography";

export interface TextFieldProps {
	accessibilityLabel: string;
	onChangeText: (text: string) => void;
	placeholder: string;
	returnKeyType?: TextInputProps["returnKeyType"];
	value: string;
}

/** 한 줄 입력란. 글자는 `bodyM`, 배경은 `bg/control`. */
export function TextField({
	accessibilityLabel,
	onChangeText,
	placeholder,
	returnKeyType,
	value,
}: TextFieldProps) {
	return (
		<TextInput
			accessibilityLabel={accessibilityLabel}
			autoCapitalize="none"
			autoCorrect={false}
			className="h-12 rounded-lg bg-bg-control px-4 text-text-primary"
			cursorColorClassName="accent-text-primary"
			maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
			onChangeText={onChangeText}
			placeholder={placeholder}
			placeholderTextColorClassName="accent-text-tertiary"
			returnKeyType={returnKeyType}
			style={TEXT_STYLES.bodyM}
			value={value}
		/>
	);
}

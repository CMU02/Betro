import { cn } from "heroui-native";
import { SearchIcon, XIcon } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, TextInput, type TextInputProps, View } from "react-native";
import { withUniwind } from "uniwind";

import { MAX_FONT_SIZE_MULTIPLIER } from "@/components/ui/app-text";
import { TEXT_STYLES } from "@/theme/typography";

const Search = withUniwind(SearchIcon);
const Clear = withUniwind(XIcon);

/** Figma `SearchBar` 아이콘(Icon/search, Icon/x) 크기 */
const SEARCH_ICON_SIZE = 20;
const CLEAR_HIT_SLOP = 12;

export interface TextFieldProps {
	accessibilityLabel: string;
	/** true면 화면이 열리자마자 입력란에 커서를 두고 키보드를 연다. 기본 false. */
	autoFocus?: boolean;
	/** false면 글자를 바꿀 수 없다. 기본 true. */
	editable?: boolean;
	onChangeText: (text: string) => void;
	placeholder: string;
	returnKeyType?: TextInputProps["returnKeyType"];
	/**
	 * 있으면 Figma `SearchBar`(5:303) 모양으로 그린다: 52pt 알약, 앞 돋보기, `border/subtle` 테두리.
	 * 글자가 있으면 테두리가 `accent/primary`가 되고 끝에 지우기(x) 버튼이 생긴다. 값은 그 버튼의 이름.
	 */
	search?: { clearLabel: string };
	value: string;
}

/** 한 줄 입력란. 글자는 `bodyM`, 배경은 `bg/control`. */
export function TextField({
	accessibilityLabel,
	autoFocus,
	editable,
	onChangeText,
	placeholder,
	returnKeyType,
	search,
	value,
}: TextFieldProps) {
	const clear = useCallback(() => onChangeText(""), [onChangeText]);
	const input = (
		<TextInput
			accessibilityLabel={accessibilityLabel}
			autoCapitalize="none"
			autoCorrect={false}
			autoFocus={autoFocus}
			className={
				search
					? "h-full flex-1 text-text-primary"
					: "h-12 rounded-lg bg-bg-control px-4 text-text-primary"
			}
			cursorColorClassName="accent-text-primary"
			editable={editable}
			maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
			onChangeText={onChangeText}
			placeholder={placeholder}
			placeholderTextColorClassName="accent-text-tertiary"
			returnKeyType={returnKeyType}
			style={TEXT_STYLES.bodyM}
			value={value}
		/>
	);
	if (search === undefined) {
		return input;
	}
	const hasText = value !== "";
	return (
		<View
			className={cn(
				"h-[52px] flex-row items-center gap-3 rounded-full border bg-bg-control px-4",
				hasText ? "border-accent-primary" : "border-border-subtle"
			)}
		>
			<Search colorClassName="accent-icon-secondary" size={SEARCH_ICON_SIZE} />
			{input}
			{hasText ? (
				<Pressable
					accessibilityLabel={search.clearLabel}
					accessibilityRole="button"
					hitSlop={CLEAR_HIT_SLOP}
					onPress={clear}
				>
					<Clear
						colorClassName="accent-icon-secondary"
						size={SEARCH_ICON_SIZE}
					/>
				</Pressable>
			) : null}
		</View>
	);
}

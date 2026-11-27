import { cn } from "heroui-native";
import { SearchIcon, XIcon } from "lucide-react-native";
import { type Ref, useCallback, useImperativeHandle, useRef } from "react";
import {
	Keyboard,
	Platform,
	Pressable,
	Text,
	TextInput,
	type TextInputProps,
	View,
} from "react-native";
import { withUniwind } from "uniwind";

import { MAX_FONT_SIZE_MULTIPLIER } from "@/components/ui/app-text";
import { TEXT_STYLES } from "@/theme/typography";

const Search = withUniwind(SearchIcon);
const Clear = withUniwind(XIcon);

/** Figma `SearchBar` 아이콘(Icon/search, Icon/x) 크기 */
const SEARCH_ICON_SIZE = 20;
const CLEAR_HIT_SLOP = 12;

/**
 * 한 줄 입력의 Android 세로 정렬. 글꼴 위아래 여백을 빼고 가운데에 맞춘다.
 * 이게 없으면 자리표시자 글자가 알약 안에서 위로 치우친다(남은 일 #4).
 */
const ANDROID_INPUT_PROPS =
	Platform.OS === "android"
		? ({ includeFontPadding: false, textAlignVertical: "center" } as const)
		: ({} as const);
const ANDROID_INPUT_STYLE = { paddingVertical: 0 } as const;

/** 화면이 입력란을 다루는 손잡이. */
export interface TextFieldHandle {
	/**
	 * 키보드가 떠 있을 때만 입력란에 커서를 다시 둔다. 칩 같은 다른 컨트롤을 누른 뒤에도 바로 이어 쓰게 하되,
	 * 목록을 끌어 키보드를 내린 사람에게 키보드를 다시 띄우지는 않는다.
	 */
	keepTyping: () => void;
}

/** 키보드가 떠 있으면 입력란에 커서를 다시 둔다(Android에서 키보드는 남고 포커스만 빠지는 경우를 막는다). */
function refocusIfTyping(input: TextInput | null): void {
	if (input !== null && Keyboard.isVisible()) {
		input.focus();
	}
}

export interface TextFieldProps {
	accessibilityLabel: string;
	/** true면 화면이 열리자마자 입력란에 커서를 두고 키보드를 연다. 기본 false. */
	autoFocus?: boolean;
	/** false면 글자를 바꿀 수 없다. 기본 true. */
	editable?: boolean;
	onChangeText: (text: string) => void;
	placeholder: string;
	/** 화면이 `keepTyping`을 부를 때 쓴다. */
	ref?: Ref<TextFieldHandle>;
	returnKeyType?: TextInputProps["returnKeyType"];
	/**
	 * 있으면 Figma `SearchBar`(5:303) 모양으로 그린다: 52pt 알약, 앞 돋보기, `border/subtle` 테두리.
	 * 글자가 있으면 테두리가 `accent/primary`가 되고 끝에 지우기(x) 버튼이 생긴다. 값은 그 버튼의 이름.
	 * 지우기를 눌러도 키보드가 떠 있었으면 입력란에 커서가 남는다.
	 */
	search?: { clearLabel: string };
	value: string;
}

const SEARCH_BAR_CLASS_NAME =
	"h-[52px] flex-row items-center gap-3 rounded-full border bg-bg-control px-4";

export interface SearchBarButtonProps {
	accessibilityLabel: string;
	onPress: () => void;
	placeholder: string;
}

/** Figma `SearchBar` Idle. 입력은 못 하고 누르면 검색 화면으로 가는 52pt 알약. */
export function SearchBarButton({
	accessibilityLabel,
	onPress,
	placeholder,
}: SearchBarButtonProps) {
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel}
			accessibilityRole="search"
			className={cn(SEARCH_BAR_CLASS_NAME, "border-border-subtle")}
			onPress={onPress}
		>
			<Search colorClassName="accent-icon-secondary" size={SEARCH_ICON_SIZE} />
			<Text
				className="flex-1 text-text-tertiary"
				maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
				numberOfLines={1}
				style={[TEXT_STYLES.bodyM, ANDROID_INPUT_STYLE, ANDROID_INPUT_PROPS]}
			>
				{placeholder}
			</Text>
		</Pressable>
	);
}

/** 한 줄 입력란. 글자는 `bodyM`, 배경은 `bg/control`. */
export function TextField({
	accessibilityLabel,
	autoFocus,
	editable,
	onChangeText,
	placeholder,
	ref,
	returnKeyType,
	search,
	value,
}: TextFieldProps) {
	const inputRef = useRef<TextInput | null>(null);
	useImperativeHandle(
		ref,
		() => ({ keepTyping: () => refocusIfTyping(inputRef.current) }),
		[]
	);
	const clear = useCallback(() => {
		onChangeText("");
		refocusIfTyping(inputRef.current);
	}, [onChangeText]);
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
			ref={inputRef}
			returnKeyType={returnKeyType}
			style={[TEXT_STYLES.bodyM, ANDROID_INPUT_STYLE, ANDROID_INPUT_PROPS]}
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
				SEARCH_BAR_CLASS_NAME,
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

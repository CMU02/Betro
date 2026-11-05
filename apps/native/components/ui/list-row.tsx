import { ChevronRightIcon } from "lucide-react-native";
import { type ComponentType, type ReactNode, useCallback } from "react";
import { Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { AppText } from "@/components/ui/app-text";
import { Toggle } from "@/components/ui/toggle";

const StyledChevron = withUniwind(ChevronRightIcon);

const TILE_ICON_SIZE = 20;
const ROW_CLASS_NAME = "min-h-[60px] flex-row items-center gap-3 px-4 py-3";
const PRESSABLE_ROW_CLASS_NAME = `${ROW_CLASS_NAME} active:bg-bg-hover`;
/** 토글 행 안의 토글은 보이기만 하고 터치는 행이 받는다. */
const DISPLAY_ONLY_STYLE = { pointerEvents: "none" } as const;

export type ListRowTrailing =
	| { type: "chevron" }
	| { type: "none" }
	| { type: "toggle"; value: boolean; onChange: (value: boolean) => void }
	| { type: "value"; text: string; chevron?: boolean };

type ToggleTrailing = Extract<ListRowTrailing, { type: "toggle" }>;

/** `withUniwind`로 감싼 Lucide 아이콘. */
export type ListRowIcon = ComponentType<{
	colorClassName?: string;
	size?: number;
}>;

export interface ListRowProps {
	/**
	 * 누를 수 있는 행의 역할. 외부 페이지를 여는 행은 "link"로 읽히게 한다.
	 * 토글 행은 행 전체가 "switch"이므로 이 값을 쓰지 않는다.
	 */
	accessibilityRole?: "button" | "link";
	icon?: ListRowIcon;
	onPress?: () => void;
	subtitle?: string;
	title: string;
	trailing: ListRowTrailing;
}

function Trailing({ trailing }: { trailing: ListRowTrailing }) {
	switch (trailing.type) {
		case "chevron":
			return <StyledChevron colorClassName="accent-icon-secondary" size={20} />;
		case "value":
			return (
				<>
					<AppText className="text-text-secondary" variant="labelM">
						{trailing.text}
					</AppText>
					{trailing.chevron ? (
						<StyledChevron colorClassName="accent-icon-secondary" size={20} />
					) : null}
				</>
			);
		default:
			return null;
	}
}

function RowContent({
	icon: Icon,
	subtitle,
	title,
	trailing,
}: {
	icon?: ListRowIcon;
	subtitle?: string;
	title: string;
	trailing: ReactNode;
}) {
	return (
		<>
			{Icon ? (
				<View className="size-10 items-center justify-center rounded-md bg-bg-control">
					<Icon colorClassName="accent-icon-primary" size={TILE_ICON_SIZE} />
				</View>
			) : null}
			<View className="flex-1 gap-0.5">
				<AppText variant="bodyMStrong">{title}</AppText>
				{subtitle ? (
					<AppText className="text-text-secondary" variant="caption">
						{subtitle}
					</AppText>
				) : null}
			</View>
			{trailing}
		</>
	);
}

/**
 * 토글 행은 행 전체가 하나의 switch다. 어디를 눌러도 토글되고, 스크린리더는 제목·상태·부제를
 * 한 번에 읽는다. 안쪽 토글은 보이기만 하고 터치와 접근성 트리에서 빠진다(두 번 바뀌지 않게).
 */
function ToggleRow({
	icon,
	subtitle,
	title,
	trailing,
}: {
	icon?: ListRowIcon;
	subtitle?: string;
	title: string;
	trailing: ToggleTrailing;
}) {
	const { onChange, value } = trailing;
	const handlePress = useCallback(() => onChange(!value), [onChange, value]);
	return (
		<Pressable
			accessibilityHint={subtitle}
			accessibilityLabel={title}
			accessibilityRole="switch"
			accessibilityState={{ checked: value }}
			accessible
			className={PRESSABLE_ROW_CLASS_NAME}
			onPress={handlePress}
		>
			<RowContent
				icon={icon}
				subtitle={subtitle}
				title={title}
				trailing={
					<View
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
						style={DISPLAY_ONLY_STYLE}
					>
						<Toggle
							accessibilityLabel={title}
							onChange={onChange}
							value={value}
						/>
					</View>
				}
			/>
		</Pressable>
	);
}

/** Figma `ListRow`(6:219). 아이콘 타일, 제목·부제, 오른쪽 chevron/토글/값. */
export function ListRow({
	accessibilityRole = "button",
	icon,
	onPress,
	subtitle,
	title,
	trailing,
}: ListRowProps) {
	if (trailing.type === "toggle") {
		return (
			<ToggleRow
				icon={icon}
				subtitle={subtitle}
				title={title}
				trailing={trailing}
			/>
		);
	}
	const content = (
		<RowContent
			icon={icon}
			subtitle={subtitle}
			title={title}
			trailing={<Trailing trailing={trailing} />}
		/>
	);
	if (onPress) {
		return (
			<Pressable
				accessibilityRole={accessibilityRole}
				className={PRESSABLE_ROW_CLASS_NAME}
				onPress={onPress}
			>
				{content}
			</Pressable>
		);
	}
	return <View className={ROW_CLASS_NAME}>{content}</View>;
}

/** 카드 안 행 사이 구분선(아이콘 타일 너비만큼 들여쓴다). */
export function ListDivider() {
	return (
		<View className="pl-[68px]">
			<View className="h-px bg-border-subtle" />
		</View>
	);
}
